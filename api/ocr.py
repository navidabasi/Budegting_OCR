"""
Vercel Python Serverless Function for OCR
Uses OCR.Space API for text extraction + invoice2data-style parsing
"""

import json
import base64
import os
import re
import tempfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.parse import urlencode

# PDF processing (works without system dependencies)
try:
    import pdfplumber
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False

# invoice2data for template matching (optional)
try:
    from invoice2data import extract_data
    from invoice2data.extract.loader import read_templates
    INVOICE2DATA_AVAILABLE = True
except ImportError:
    INVOICE2DATA_AVAILABLE = False


OCR_SPACE_API_URL = 'https://api.ocr.space/parse/image'
OCR_SPACE_FREE_KEY = 'helloworld'  # Free tier test key


def get_templates_path():
    """Get path to templates directory"""
    api_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(api_dir, 'templates')


def call_ocr_space(file_data, file_name, api_key=None):
    """Call OCR.Space API to extract text from image"""
    try:
        # Prepare multipart form data
        boundary = f'----WebKitFormBoundary{int(datetime.now().timestamp())}'

        # Determine MIME type
        ext = os.path.splitext(file_name)[1].lower() if file_name else '.jpg'
        mime_types = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.pdf': 'application/pdf'
        }
        mime_type = mime_types.get(ext, 'image/jpeg')

        # Build multipart body
        parts = []

        # API key
        actual_key = api_key or OCR_SPACE_FREE_KEY
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="apikey"\r\n\r\n{actual_key}\r\n')

        # OCR settings
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\neng\r\n')
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="OCREngine"\r\n\r\n2\r\n')
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="detectOrientation"\r\n\r\ntrue\r\n')
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="scale"\r\n\r\ntrue\r\n')
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="isTable"\r\n\r\ntrue\r\n')
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="isOverlayRequired"\r\n\r\ntrue\r\n')

        # File
        file_header = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\nContent-Type: {mime_type}\r\n\r\n'

        # Combine parts
        body = ''.join(parts).encode('utf-8') + file_header.encode('utf-8') + file_data + f'\r\n--{boundary}--\r\n'.encode('utf-8')

        # Make request
        request = Request(
            OCR_SPACE_API_URL,
            data=body,
            headers={
                'Content-Type': f'multipart/form-data; boundary={boundary}'
            }
        )

        with urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))

        if result.get('OCRExitCode') == 1 and result.get('ParsedResults'):
            parsed_text = result['ParsedResults'][0].get('ParsedText', '')
            text_overlay = result['ParsedResults'][0].get('TextOverlay')
            return parsed_text, text_overlay
        else:
            error_msg = result.get('ErrorMessage', ['OCR processing failed'])[0]
            print(f"[OCR] OCR.Space error: {error_msg}")
            return '', None

    except Exception as e:
        print(f"[OCR] OCR.Space API error: {e}")
        return '', None


def parse_price(text):
    """Parse price from text, handling EU and US formats"""
    if not text:
        return 0.0

    text = re.sub(r'[$€£¥]', '', str(text)).strip()

    if ',' in text and '.' in text:
        if text.index(',') > text.index('.'):
            text = text.replace('.', '').replace(',', '.')
        else:
            text = text.replace(',', '')
    elif ',' in text:
        parts = text.split(',')
        if len(parts) == 2 and len(parts[1]) == 2:
            text = text.replace(',', '.')
        else:
            text = text.replace(',', '')

    try:
        return float(text)
    except ValueError:
        return 0.0


def extract_date_from_text(text):
    """Extract date from text using common patterns"""
    date_patterns = [
        (r'(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})', 'DMY'),
        (r'(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})', 'YMD'),
        (r'(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})', 'MDY'),
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
            except (ValueError, IndexError):
                continue

    return None


def extract_prices_from_text(text):
    """Extract all prices from text"""
    prices = []
    pattern = r'[$€£]?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})'
    matches = re.findall(pattern, text)

    for match in matches:
        price = parse_price(match)
        if price > 0:
            prices.append(price)

    return prices


def extract_line_items_from_overlay(text_overlay):
    """Extract line items using OCR overlay bounding box data"""
    items = []

    if not text_overlay or 'Lines' not in text_overlay:
        return items

    lines = text_overlay['Lines']
    if not lines:
        return items

    # Calculate document dimensions for sectioning
    max_height = max((l.get('MinTop', 0) + l.get('MaxHeight', 0)) for l in lines) if lines else 0

    # Skip header (top 25%) and footer (bottom 25%)
    header_threshold = max_height * 0.25
    footer_threshold = max_height * 0.75

    skip_patterns = [
        r'^total|^subtotal|^tax|^iva|^vat',
        r'^thank|^grazie|^merci',
        r'^\d{5,}$',
        r'^change|^cash|^card',
    ]

    for line in lines:
        y_pos = line.get('MinTop', 0)

        # Skip header and footer sections
        if y_pos < header_threshold or y_pos > footer_threshold:
            continue

        words = line.get('Words', [])
        if not words:
            continue

        # Find prices in this line
        price_words = [w for w in words if re.match(r'^\$?€?£?\d+[.,]\d{2}$', w.get('WordText', ''))]

        if price_words:
            price_word = price_words[0]
            price_x = price_word.get('Left', 0)

            # Item name is everything to the left of the price
            name_words = [w for w in words
                         if w.get('Left', 0) < price_x
                         and not re.match(r'^\d+[.,]\d{2}%?$', w.get('WordText', ''))]

            if name_words:
                name = ' '.join(w.get('WordText', '') for w in name_words).strip()
                price_text = price_word.get('WordText', '').replace('$', '').replace('€', '').replace('£', '')
                price = parse_price(price_text)

                # Validate
                should_skip = any(re.search(p, name, re.IGNORECASE) for p in skip_patterns)

                if name and len(name) >= 2 and 0 < price < 10000 and not should_skip:
                    items.append({
                        'name': name,
                        'quantity': 1,
                        'price': price,
                        'category': 'Other'
                    })

    return items


def extract_line_items_from_text(text):
    """Extract line items from plain text"""
    items = []
    lines = text.split('\n')

    skip_patterns = [
        r'^total|^subtotal|^tax|^iva|^vat',
        r'^thank|^grazie|^merci',
        r'^\d{5,}$',
        r'^change|^cash|^card|^visa|^mastercard',
    ]

    for line in lines:
        line = line.strip()
        if not line or len(line) < 3:
            continue

        should_skip = any(re.search(p, line, re.IGNORECASE) for p in skip_patterns)
        if should_skip:
            continue

        price_match = re.search(r'(\d{1,3}[.,]\d{2})\s*$', line)
        if price_match:
            price_str = price_match.group(1)
            price = parse_price(price_str)

            name = line[:price_match.start()].strip()
            name = re.sub(r'^[X\+\*\-\d]+\s*', '', name)
            name = re.sub(r'\s+\d+[.,]\d{2}%?\s*', ' ', name)
            name = name.strip()

            if name and len(name) >= 2 and 0 < price < 10000:
                items.append({
                    'name': name,
                    'quantity': 1,
                    'price': price,
                    'category': 'Other'
                })

    return items


def extract_merchant_from_overlay(text_overlay):
    """Extract merchant name from header section of overlay"""
    if not text_overlay or 'Lines' not in text_overlay:
        return None

    lines = text_overlay['Lines']
    if not lines:
        return None

    # Get lines in top 25% (header area)
    max_height = max((l.get('MinTop', 0) + l.get('MaxHeight', 0)) for l in lines) if lines else 0
    header_threshold = max_height * 0.25

    header_lines = [l for l in lines if l.get('MinTop', 0) < header_threshold]

    for line in header_lines[:3]:  # Check first 3 header lines
        words = line.get('Words', [])
        if words:
            text = ' '.join(w.get('WordText', '') for w in words).strip()

            # Skip if looks like date, address, or number
            if text and not re.match(r'^\d|^via |^tel|^phone', text, re.IGNORECASE):
                if 2 <= len(text) <= 60:
                    return text

    return None


def extract_total_from_overlay(text_overlay):
    """Extract total from footer section of overlay"""
    if not text_overlay or 'Lines' not in text_overlay:
        return 0

    lines = text_overlay['Lines']
    if not lines:
        return 0

    # Get lines in bottom 25% (footer area)
    max_height = max((l.get('MinTop', 0) + l.get('MaxHeight', 0)) for l in lines) if lines else 0
    footer_threshold = max_height * 0.75

    footer_lines = [l for l in lines if l.get('MinTop', 0) > footer_threshold]

    total_keywords = ['total', 'totale', 'grand total', 'amount due', 'balance']

    for line in footer_lines:
        words = line.get('Words', [])
        line_text = ' '.join(w.get('WordText', '') for w in words).lower()

        # Check if line contains total keyword
        if any(kw in line_text for kw in total_keywords):
            # Find price in this line
            for word in words:
                text = word.get('WordText', '')
                if re.match(r'^\$?€?£?\d+[.,]\d{2}$', text):
                    price_text = text.replace('$', '').replace('€', '').replace('£', '')
                    return parse_price(price_text)

    return 0


def parse_receipt(raw_text, text_overlay=None):
    """Parse receipt data from OCR text and optional overlay"""
    result = {
        'merchant': None,
        'date': None,
        'total': 0,
        'currency': 'EUR',
        'category': 'Other',
        'lineItems': [],
        'notes': raw_text[:500] if raw_text else '',
        'rawData': {'parsedText': raw_text}
    }

    # Try overlay-based extraction first (more accurate)
    if text_overlay:
        result['merchant'] = extract_merchant_from_overlay(text_overlay)
        result['total'] = extract_total_from_overlay(text_overlay)
        result['lineItems'] = extract_line_items_from_overlay(text_overlay)

    # Fallback to text-based extraction
    if not result['merchant']:
        lines = [l.strip() for l in raw_text.split('\n') if l.strip()]
        for line in lines[:5]:
            if re.match(r'^\d|^via |^tel|^phone|^fax', line, re.IGNORECASE):
                continue
            if 2 <= len(line) <= 60:
                result['merchant'] = line
                break

    if not result['merchant']:
        result['merchant'] = 'Unknown Merchant'

    # Extract date
    result['date'] = extract_date_from_text(raw_text) or datetime.now().isoformat()

    # Fallback for line items
    if not result['lineItems']:
        result['lineItems'] = extract_line_items_from_text(raw_text)

    # Fallback for total
    if result['total'] == 0:
        total_patterns = [
            r'(?:total|totale|grand total|amount due|balance)[:\s]*[$€£]?\s*(\d+[.,]\d{2})',
        ]
        for pattern in total_patterns:
            match = re.search(pattern, raw_text, re.IGNORECASE)
            if match:
                result['total'] = parse_price(match.group(1))
                break

    # Last resort: use max price as total
    if result['total'] == 0:
        prices = extract_prices_from_text(raw_text)
        if prices:
            result['total'] = max(prices)

    return result


def process_receipt(file_data, file_name, api_key=None):
    """Main processing function"""
    ext = os.path.splitext(file_name)[1].lower() if file_name else '.jpg'
    is_pdf = ext == '.pdf'

    raw_text = ''
    text_overlay = None

    if is_pdf and PDF_AVAILABLE:
        # For PDFs, try pdfplumber first (free, no API needed)
        try:
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                tmp.write(file_data)
                tmp_path = tmp.name

            with pdfplumber.open(tmp_path) as pdf:
                raw_text = '\n'.join(
                    page.extract_text() or '' for page in pdf.pages
                )

            os.remove(tmp_path)
            print(f"[OCR] PDF text extracted: {len(raw_text)} chars")

        except Exception as e:
            print(f"[OCR] PDF extraction error: {e}")

    # Use OCR.Space for images or if PDF extraction failed
    if not raw_text:
        raw_text, text_overlay = call_ocr_space(file_data, file_name, api_key)
        print(f"[OCR] OCR.Space extracted: {len(raw_text)} chars, overlay: {text_overlay is not None}")

    # Parse the extracted text
    result = parse_receipt(raw_text, text_overlay)

    return result


class handler(BaseHTTPRequestHandler):
    """Vercel Python serverless handler"""

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS, GET')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        response = {
            'message': 'OCR service is running',
            'timestamp': datetime.now().isoformat(),
            'engine': 'OCR.Space + invoice2data parsing',
            'pdf_available': PDF_AVAILABLE,
            'invoice2data_available': INVOICE2DATA_AVAILABLE
        }
        self.wfile.write(json.dumps(response).encode())

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode('utf-8'))

            file_base64 = data.get('file')
            file_name = data.get('fileName', 'receipt.jpg')
            api_key = data.get('apiKey')

            if not file_base64:
                self.send_error_response(400, 'File is required')
                return

            print(f"[OCR] Processing file: {file_name}")

            file_data = base64.b64decode(file_base64)
            result = process_receipt(file_data, file_name, api_key)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            self.wfile.write(json.dumps(result).encode())

        except Exception as e:
            print(f"[OCR] Error: {e}")
            import traceback
            traceback.print_exc()
            self.send_error_response(500, str(e))

    def send_error_response(self, status_code, message):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        response = {'error': message}
        self.wfile.write(json.dumps(response).encode())
