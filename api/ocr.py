"""
Vercel Python Serverless Function for OCR using invoice2data
Processes receipt images and PDFs using template-based extraction
"""

import json
import base64
import os
import re
import tempfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler

# invoice2data imports
from invoice2data import extract_data
from invoice2data.extract.loader import read_templates

# Image processing
from PIL import Image
import pytesseract


def get_templates_path():
    """Get path to templates directory"""
    # Templates are in api/templates/ relative to this file
    api_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(api_dir, 'templates')


def extract_text_from_image(image_path):
    """Use Tesseract OCR to extract text from image"""
    try:
        image = Image.open(image_path)
        # Configure Tesseract for receipt-like documents
        custom_config = r'--oem 3 --psm 6 -c preserve_interword_spaces=1'
        text = pytesseract.image_to_string(image, config=custom_config)
        return text
    except Exception as e:
        print(f"[OCR] Tesseract error: {e}")
        return ""


def extract_with_invoice2data(file_path, is_pdf=False):
    """Extract data using invoice2data templates"""
    templates_path = get_templates_path()

    try:
        # Load templates
        templates = read_templates(templates_path)
        print(f"[OCR] Loaded {len(templates)} templates from {templates_path}")

        # Extract data using invoice2data
        result = extract_data(file_path, templates=templates)

        if result:
            print(f"[OCR] invoice2data matched template: {result.get('issuer', 'unknown')}")
            return result
        else:
            print("[OCR] No template matched, falling back to generic extraction")
            return None

    except Exception as e:
        print(f"[OCR] invoice2data error: {e}")
        return None


def parse_price(text):
    """Parse price from text, handling EU and US formats"""
    if not text:
        return 0.0

    # Remove currency symbols
    text = re.sub(r'[$€£¥]', '', str(text)).strip()

    # Handle EU format (1.234,56 or 1,56)
    if ',' in text and '.' in text:
        if text.index(',') > text.index('.'):
            # EU format: 1.234,56
            text = text.replace('.', '').replace(',', '.')
        # else US format: 1,234.56 - just remove comma
        else:
            text = text.replace(',', '')
    elif ',' in text:
        # Could be EU decimal (1,56) or US thousands (1,234)
        parts = text.split(',')
        if len(parts) == 2 and len(parts[1]) == 2:
            # EU decimal format
            text = text.replace(',', '.')
        else:
            # US thousands separator
            text = text.replace(',', '')

    try:
        return float(text)
    except ValueError:
        return 0.0


def extract_date_from_text(text):
    """Extract date from text using common patterns"""
    date_patterns = [
        # DD/MM/YYYY or DD-MM-YYYY
        (r'(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})', 'DMY'),
        # YYYY/MM/DD or YYYY-MM-DD
        (r'(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})', 'YMD'),
        # MM/DD/YYYY (US format)
        (r'(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})', 'MDY'),
        # Written dates: Jan 15, 2024
        (r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})', 'WRITTEN'),
    ]

    for pattern, format_type in date_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            try:
                if format_type == 'DMY':
                    day, month, year = match.groups()
                    return datetime(int(year), int(month), int(day)).isoformat()
                elif format_type == 'YMD':
                    year, month, day = match.groups()
                    return datetime(int(year), int(month), int(day)).isoformat()
                elif format_type == 'MDY':
                    month, day, year = match.groups()
                    if len(year) == 2:
                        year = '20' + year
                    return datetime(int(year), int(month), int(day)).isoformat()
                elif format_type == 'WRITTEN':
                    from dateutil import parser
                    date_str = match.group(0)
                    return parser.parse(date_str).isoformat()
            except (ValueError, IndexError):
                continue

    return None


def extract_prices_from_text(text):
    """Extract all prices from text"""
    prices = []
    # Match prices with optional currency symbol
    pattern = r'[$€£]?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})'
    matches = re.findall(pattern, text)

    for match in matches:
        price = parse_price(match)
        if price > 0:
            prices.append(price)

    return prices


def extract_line_items(text):
    """Extract line items from receipt text"""
    items = []
    lines = text.split('\n')

    # Skip patterns
    skip_patterns = [
        r'^total|^subtotal|^tax|^iva|^vat',
        r'^thank|^grazie|^merci',
        r'^\d{5,}$',  # Long numbers (VAT, phone)
        r'^change|^cash|^card|^visa|^mastercard',
    ]

    for line in lines:
        line = line.strip()
        if not line or len(line) < 3:
            continue

        # Skip non-item lines
        should_skip = any(re.search(p, line, re.IGNORECASE) for p in skip_patterns)
        if should_skip:
            continue

        # Look for price at end of line
        price_match = re.search(r'(\d{1,3}[.,]\d{2})\s*$', line)
        if price_match:
            price_str = price_match.group(1)
            price = parse_price(price_str)

            # Get item name (everything before the price)
            name = line[:price_match.start()].strip()

            # Clean up name
            name = re.sub(r'^[X\+\*\-\d]+\s*', '', name)  # Remove markers
            name = re.sub(r'\s+\d+[.,]\d{2}%?\s*', ' ', name)  # Remove embedded prices/percentages
            name = name.strip()

            if name and len(name) >= 2 and 0 < price < 10000:
                items.append({
                    'name': name,
                    'quantity': 1,
                    'price': price,
                    'category': 'Other'
                })

    return items


def generic_extraction(text):
    """
    Generic extraction when no invoice2data template matches.
    Uses regex-based heuristics for receipts.
    """
    result = {
        'merchant': None,
        'date': None,
        'total': 0,
        'currency': 'EUR',
        'category': 'Other',
        'lineItems': [],
        'notes': text[:500] if text else '',
        'rawData': {'parsedText': text}
    }

    lines = [l.strip() for l in text.split('\n') if l.strip()]

    # Extract merchant (usually first non-empty, non-date line)
    for line in lines[:5]:
        # Skip if looks like date, number, or address
        if re.match(r'^\d|^via |^tel|^phone|^fax', line, re.IGNORECASE):
            continue
        if len(line) >= 2 and len(line) <= 60:
            result['merchant'] = line
            break

    if not result['merchant']:
        result['merchant'] = 'Unknown Merchant'

    # Extract date
    result['date'] = extract_date_from_text(text) or datetime.now().isoformat()

    # Extract line items
    result['lineItems'] = extract_line_items(text)

    # Extract total
    total_patterns = [
        r'(?:total|totale|grand total|amount due|balance)[:\s]*[$€£]?\s*(\d+[.,]\d{2})',
        r'(?:total|totale)[^\d]*(\d+[.,]\d{2})',
    ]

    for pattern in total_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            result['total'] = parse_price(match.group(1))
            break

    # If no total found, use max price
    if result['total'] == 0:
        prices = extract_prices_from_text(text)
        if prices:
            result['total'] = max(prices)

    return result


def convert_invoice2data_result(i2d_result, raw_text):
    """Convert invoice2data result to our receipt format"""
    result = {
        'merchant': i2d_result.get('issuer', 'Unknown Merchant'),
        'date': None,
        'total': 0,
        'currency': i2d_result.get('currency', 'EUR'),
        'category': 'Other',
        'lineItems': [],
        'notes': raw_text[:500] if raw_text else '',
        'rawData': {'parsedText': raw_text, 'invoice2data': i2d_result}
    }

    # Date
    if 'date' in i2d_result:
        date_val = i2d_result['date']
        if isinstance(date_val, datetime):
            result['date'] = date_val.isoformat()
        else:
            result['date'] = str(date_val)
    else:
        result['date'] = datetime.now().isoformat()

    # Total amount
    if 'amount' in i2d_result:
        result['total'] = float(i2d_result['amount'])
    elif 'total' in i2d_result:
        result['total'] = float(i2d_result['total'])

    # Line items
    if 'lines' in i2d_result and isinstance(i2d_result['lines'], list):
        for line in i2d_result['lines']:
            if isinstance(line, dict):
                item = {
                    'name': line.get('description', line.get('name', 'Item')),
                    'quantity': int(line.get('qty', line.get('quantity', 1))),
                    'price': float(line.get('price', line.get('amount', 0))),
                    'category': 'Other'
                }
                if item['price'] > 0:
                    result['lineItems'].append(item)

    # If no line items from invoice2data, try generic extraction
    if not result['lineItems'] and raw_text:
        result['lineItems'] = extract_line_items(raw_text)

    return result


def process_receipt(file_data, file_name):
    """Main processing function"""
    # Determine file type
    ext = os.path.splitext(file_name)[1].lower() if file_name else '.jpg'
    is_pdf = ext == '.pdf'

    # Create temp file
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(file_data)
        tmp_path = tmp.name

    try:
        raw_text = ""

        # Extract text based on file type
        if is_pdf:
            # For PDFs, invoice2data can handle directly
            pass
        else:
            # For images, extract text with Tesseract first
            raw_text = extract_text_from_image(tmp_path)
            print(f"[OCR] Extracted text length: {len(raw_text)}")

        # Try invoice2data template matching
        i2d_result = extract_with_invoice2data(tmp_path, is_pdf)

        if i2d_result:
            # Template matched - convert to our format
            result = convert_invoice2data_result(i2d_result, raw_text)
        else:
            # No template match - use generic extraction
            if not raw_text and is_pdf:
                # Extract text from PDF for generic extraction
                import pdfplumber
                with pdfplumber.open(tmp_path) as pdf:
                    raw_text = '\n'.join(
                        page.extract_text() or '' for page in pdf.pages
                    )

            result = generic_extraction(raw_text)

        return result

    finally:
        # Clean up temp file
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


class handler(BaseHTTPRequestHandler):
    """Vercel Python serverless handler"""

    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS, GET')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        """Health check endpoint"""
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        response = {
            'message': 'invoice2data OCR service is running',
            'timestamp': datetime.now().isoformat(),
            'engine': 'invoice2data + tesseract'
        }
        self.wfile.write(json.dumps(response).encode())

    def do_POST(self):
        """Process receipt image/PDF"""
        try:
            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode('utf-8'))

            file_base64 = data.get('file')
            file_name = data.get('fileName', 'receipt.jpg')

            if not file_base64:
                self.send_error_response(400, 'File is required')
                return

            print(f"[OCR] Processing file: {file_name}")

            # Decode base64 file
            file_data = base64.b64decode(file_base64)

            # Process the receipt
            result = process_receipt(file_data, file_name)

            # Send success response
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            self.wfile.write(json.dumps(result).encode())

        except Exception as e:
            print(f"[OCR] Error: {e}")
            self.send_error_response(500, str(e))

    def send_error_response(self, status_code, message):
        """Send error response"""
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        response = {'error': message}
        self.wfile.write(json.dumps(response).encode())
