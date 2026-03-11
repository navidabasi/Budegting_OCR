"""
Vercel Python Serverless Function for OCR
Uses OCR.Space API for text extraction + template-based parsing
"""

import json
import base64
import os
import re
import tempfile
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.parse import urlparse

# YAML for template loading
try:
    import yaml
    YAML_AVAILABLE = True
except ImportError:
    YAML_AVAILABLE = False

# PDF processing (works without system dependencies)
try:
    import pdfplumber
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False


OCR_SPACE_API_URL = 'https://api.ocr.space/parse/image'
OCR_SPACE_SERVER_API_KEY = os.getenv('OCR_SPACE_API_KEY')
ALLOW_FREE_OCR_FALLBACK = os.getenv('ALLOW_FREE_OCR_FALLBACK', 'false').lower() == 'true'
OCR_SPACE_FREE_KEY = 'helloworld' if ALLOW_FREE_OCR_FALLBACK else None
INVOICE2DATA_AVAILABLE = False

DEFAULT_ALLOWED_ORIGINS = {
    'http://localhost:5173',
    'http://127.0.0.1:5173',
}


def _safe_int_env(var_name, default):
    value = os.getenv(var_name)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


MAX_REQUEST_BYTES = _safe_int_env('MAX_OCR_REQUEST_BYTES', 12 * 1024 * 1024)
OCR_RATE_LIMIT_REQUESTS = _safe_int_env('OCR_RATE_LIMIT_REQUESTS', 30)
OCR_RATE_LIMIT_WINDOW_SECONDS = _safe_int_env('OCR_RATE_LIMIT_WINDOW_SECONDS', 60)
ALLOW_VERCEL_PREVIEWS = os.getenv('ALLOW_VERCEL_PREVIEWS', 'false').lower() == 'true'
_rate_limit_state = {}


def get_allowed_origins():
    """Build an origin allow-list from environment and sane defaults."""
    configured = {
        origin.strip().rstrip('/')
        for origin in os.getenv('ALLOWED_ORIGINS', '').split(',')
        if origin.strip()
    }
    app_url = os.getenv('APP_URL', '').strip().rstrip('/')
    if app_url:
        configured.add(app_url)
    return configured | DEFAULT_ALLOWED_ORIGINS


ALLOWED_ORIGINS = get_allowed_origins()

# Cache for loaded templates
_templates_cache = None


def _normalize_host(value):
    return (value or '').strip().lower()


def _is_same_host_origin(origin, request_host):
    if not origin or not request_host:
        return False

    try:
        origin_host = _normalize_host(urlparse(origin).netloc)
    except Exception:
        return False

    normalized_request_host = _normalize_host(request_host)
    return bool(origin_host) and origin_host == normalized_request_host


def is_origin_allowed(origin, request_host=None):
    """Check whether request origin is allowed to call this endpoint."""
    if not origin:
        return True

    normalized_origin = origin.strip().rstrip('/')
    if normalized_origin in ALLOWED_ORIGINS:
        return True

    if _is_same_host_origin(normalized_origin, request_host):
        return True

    if (
        ALLOW_VERCEL_PREVIEWS
        and normalized_origin.startswith('https://')
        and normalized_origin.endswith('.vercel.app')
    ):
        return True

    return False


def get_client_identifier(headers):
    """Get client identifier for best-effort rate limiting."""
    forwarded_for = headers.get('x-forwarded-for')
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    return headers.get('x-real-ip', 'unknown')


def is_rate_limited(client_id):
    """Simple in-memory rate limiter suitable for serverless best-effort protection."""
    now = int(time.time())

    expired_clients = [
        key for key, value in _rate_limit_state.items()
        if now >= value['reset_at']
    ]
    for key in expired_clients:
        _rate_limit_state.pop(key, None)

    entry = _rate_limit_state.get(client_id)

    if not entry or now >= entry['reset_at']:
        _rate_limit_state[client_id] = {
            'count': 1,
            'reset_at': now + OCR_RATE_LIMIT_WINDOW_SECONDS
        }
        return False

    entry['count'] += 1
    if entry['count'] > OCR_RATE_LIMIT_REQUESTS:
        return True

    return False


def get_templates_path():
    """Get path to templates directory"""
    api_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(api_dir, 'templates')


def load_templates():
    """Load all YAML templates from templates directory"""
    global _templates_cache

    if _templates_cache is not None:
        return _templates_cache

    if not YAML_AVAILABLE:
        print("[OCR] PyYAML not available, skipping template loading")
        return []

    templates = []
    templates_path = get_templates_path()

    if not os.path.exists(templates_path):
        print(f"[OCR] Templates directory not found: {templates_path}")
        return []

    for filename in os.listdir(templates_path):
        if filename.endswith('.yml') or filename.endswith('.yaml'):
            filepath = os.path.join(templates_path, filename)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    template = yaml.safe_load(f)
                    if template:
                        template['_filename'] = filename
                        templates.append(template)
                        print(f"[OCR] Loaded template: {template.get('issuer', filename)}")
            except Exception as e:
                print(f"[OCR] Error loading template {filename}: {e}")

    _templates_cache = templates
    print(f"[OCR] Loaded {len(templates)} templates")
    return templates


def match_template(text):
    """Find the best matching template for the given text"""
    templates = load_templates()
    text_lower = text.lower()

    best_match = None
    best_score = 0

    for template in templates:
        keywords = template.get('keywords', [])
        score = 0

        for keyword in keywords:
            if keyword.lower() in text_lower:
                score += 1

        if score > best_score:
            best_score = score
            best_match = template

    if best_match and best_score > 0:
        print(f"[OCR] Matched template: {best_match.get('issuer')} (score: {best_score})")
        return best_match

    return None


def extract_with_template(text, template):
    """Extract data using a matched template"""
    result = {
        'merchant': template.get('issuer', 'Unknown'),
        'date': None,
        'total': 0,
        'currency': 'EUR',
        'category': 'Other',
        'lineItems': [],
        'notes': text[:500] if text else '',
        'rawData': {'parsedText': text, 'template': template.get('issuer')}
    }

    fields = template.get('fields', {})

    # Extract amount/total
    if 'amount' in fields:
        amount_config = fields['amount']
        regex = amount_config.get('regex')
        if regex:
            match = re.search(regex, text, re.IGNORECASE)
            if match:
                result['total'] = parse_price(match.group(1))
                print(f"[OCR] Template extracted total: {result['total']}")

    # Extract date
    if 'date' in fields:
        date_config = fields['date']
        regex = date_config.get('regex')
        if regex:
            match = re.search(regex, text)
            if match:
                date_str = match.group(1)
                result['date'] = extract_date_from_text(date_str)
                print(f"[OCR] Template extracted date: {result['date']}")

    if not result['date']:
        result['date'] = extract_date_from_text(text) or datetime.now().isoformat()

    # Extract line items
    lines_config = template.get('lines', {})
    if lines_config:
        result['lineItems'] = extract_template_lines(text, lines_config)

    return result


def extract_template_lines(text, lines_config):
    """Extract line items using template line configuration"""
    items = []

    start_pattern = lines_config.get('start')
    end_pattern = lines_config.get('end')
    line_pattern = lines_config.get('line')
    skip_pattern = lines_config.get('skip_line')

    if not line_pattern:
        return items

    lines = text.split('\n')
    in_items_section = False if start_pattern else True

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Check for section start
        if start_pattern and not in_items_section:
            if re.search(start_pattern, line, re.IGNORECASE):
                in_items_section = True
                continue

        # Check for section end
        if end_pattern and in_items_section:
            if re.search(end_pattern, line, re.IGNORECASE):
                break

        if not in_items_section:
            continue

        # Skip lines matching skip pattern
        if skip_pattern and re.search(skip_pattern, line, re.IGNORECASE):
            continue

        # Try to match line pattern
        match = re.match(line_pattern, line, re.IGNORECASE)
        if match:
            groups = match.groupdict()
            description = groups.get('description', '').strip()
            price_str = groups.get('price', '0')

            # Clean description - remove VAT percentages
            description = re.sub(r'\s+\d{1,2}%\s*$', '', description)
            description = re.sub(r'\s+\d{1,2}%\s+', ' ', description)
            description = description.strip()

            price = parse_price(price_str)

            if description and len(description) >= 2 and 0 < price < 10000:
                items.append({
                    'name': description,
                    'quantity': int(groups.get('qty', 1)) if groups.get('qty') else 1,
                    'price': price,
                    'category': 'Other'
                })
                print(f"[OCR] Template line item: '{description}' = {price}")

    return items


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

        # API key (user-provided first, then server key, optional free fallback if explicitly enabled)
        actual_key = api_key or OCR_SPACE_SERVER_API_KEY or OCR_SPACE_FREE_KEY
        if not actual_key:
            raise ValueError('OCR API key is required. Add one in Settings or configure OCR_SPACE_API_KEY on the server.')
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

    text = re.sub(r'[$€£¥]', '', str(text))
    text = re.sub(r'\s+', '', text).strip()

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
    pattern = r'[$€£]?\s*(\d{1,3}(?:[.,]\d{3})*\s*[.,]\s*\d{2})'
    matches = re.findall(pattern, text)

    for match in matches:
        price = parse_price(match)
        if price > 0:
            prices.append(price)

    return prices


def is_valid_merchant_name(candidate):
    """Validate merchant candidate text and reject common OCR noise."""
    if not candidate:
        return False

    text = re.sub(r'^[\*\-\s]+|[\*\-\s]+$', '', candidate).strip()
    if len(text) < 3 or len(text) > 80:
        return False

    if re.match(r'^\d', text):
        return False

    if not re.search(r'[A-Za-zÀ-ÖØ-öø-ÿ]', text):
        return False

    normalized = re.sub(r'[^A-Za-zÀ-ÖØ-öø-ÿ0-9 ]', ' ', text).strip().lower()
    banned_exact = {
        'euro', 'totale', 'total', 'iva', 'vat', 'documento', 'scontrino',
        'descrizione', 'prestazione', 'pagamento'
    }
    banned_prefixes = ('cassa', 'documento commerciale', 'p v ')
    if normalized in banned_exact:
        return False
    if any(normalized.startswith(prefix) for prefix in banned_prefixes):
        return False

    return True


def extract_merchant_from_text(raw_text):
    """Extract merchant from OCR text when overlay is missing or noisy."""
    if not raw_text:
        return None

    lines = [line.strip() for line in raw_text.split('\n') if line.strip()]

    for line in lines[:10]:
        for token in re.split(r'[\*\|]', line):
            candidate = token.strip()
            if is_valid_merchant_name(candidate):
                return re.sub(r'\s{2,}', ' ', candidate)

    for line in lines[:10]:
        candidate = re.sub(r'\s{2,}', ' ', line).strip()
        if is_valid_merchant_name(candidate):
            return candidate

    return None


def find_price_column(lines):
    """
    Analyze lines to find the X position of the price column.
    In tabular receipts, prices are usually right-aligned in a specific column.
    """
    price_positions = []

    for line in lines:
        words = line.get('Words', [])
        for word in words:
            text = word.get('WordText', '')
            # Match prices (with optional space in decimal: "2, 79" or "2,79")
            if re.match(r'^\d{1,3}[.,]\s?\d{2}$', text.replace(' ', '')):
                price_positions.append(word.get('Left', 0))

    if price_positions:
        # Return the most common price column position (with some tolerance)
        from collections import Counter
        # Round positions to nearest 10 pixels for grouping
        rounded = [round(p / 10) * 10 for p in price_positions]
        most_common = Counter(rounded).most_common(1)
        if most_common:
            return most_common[0][0]

    return None


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

    # Dynamic section boundaries (more flexible for tabular receipts)
    header_threshold = max_height * 0.20  # Top 20%
    footer_threshold = max_height * 0.80  # Bottom 20%

    # Find where item section starts (after DESCRIZIONE header)
    items_start_y = None
    items_end_y = None

    for line in lines:
        words = line.get('Words', [])
        line_text = ' '.join(w.get('WordText', '') for w in words).lower()

        # Detect header row
        if 'descrizione' in line_text or 'description' in line_text or 'item' in line_text:
            items_start_y = line.get('MinTop', 0) + line.get('MaxHeight', 20)

        # Detect end of items (subtotal/total)
        if items_start_y and ('subtotale' in line_text or 'totale' in line_text):
            items_end_y = line.get('MinTop', 0)
            break

    # If we found explicit boundaries, use them
    if items_start_y:
        header_threshold = items_start_y
    if items_end_y:
        footer_threshold = items_end_y

    print(f"[OCR] Item section Y range: {header_threshold} to {footer_threshold}")

    # Find the price column position
    price_column_x = find_price_column(lines)
    print(f"[OCR] Detected price column at X: {price_column_x}")

    skip_patterns = [
        r'^total|^subtotal|^tax|^iva\s*$|^vat\s*$',
        r'^thank|^grazie|^merci',
        r'^\d{5,}$',
        r'^change|^cash|^card|^pagamento',
        r'^descrizione|^prezzo|^importo',
    ]

    for line in lines:
        y_pos = line.get('MinTop', 0)

        # Skip header and footer sections
        if y_pos < header_threshold or y_pos > footer_threshold:
            continue

        words = line.get('Words', [])
        if not words:
            continue

        # Get full line text for skip check
        full_line = ' '.join(w.get('WordText', '') for w in words)
        should_skip = any(re.search(p, full_line, re.IGNORECASE) for p in skip_patterns)
        if should_skip:
            continue

        # Find price in this line (rightmost number matching price format)
        price_words = []
        for w in words:
            text = w.get('WordText', '').replace(' ', '')
            # Match price formats: 2,79 or 2.79 or €2,79
            if re.match(r'^[€$£]?\d{1,3}[.,]\d{2}$', text):
                price_words.append(w)

        if price_words:
            # Use the rightmost price (typically the item price, not VAT)
            price_word = max(price_words, key=lambda w: w.get('Left', 0))
            price_x = price_word.get('Left', 0)

            # Item name is everything to the left of the price, excluding:
            # - Other prices
            # - Percentages (VAT)
            name_words = []
            for w in words:
                w_text = w.get('WordText', '')
                w_x = w.get('Left', 0)

                # Skip if it's to the right of or at the price
                if w_x >= price_x:
                    continue

                # Skip percentages (VAT)
                if re.match(r'^\d{1,2}%$', w_text):
                    continue

                # Skip other prices
                if re.match(r'^[€$£]?\d{1,3}[.,]\d{2}$', w_text.replace(' ', '')):
                    continue

                name_words.append(w)

            if name_words:
                # Sort by X position and join
                name_words.sort(key=lambda w: w.get('Left', 0))
                name = ' '.join(w.get('WordText', '') for w in name_words).strip()

                price_text = price_word.get('WordText', '').replace('€', '').replace('$', '').replace('£', '').replace(' ', '')
                price = parse_price(price_text)

                # Clean up name
                name = re.sub(r'^\d+\s*', '', name)  # Remove leading quantity numbers
                name = name.strip()

                if name and len(name) >= 2 and 0 < price < 10000:
                    items.append({
                        'name': name,
                        'quantity': 1,
                        'price': price,
                        'category': 'Other'
                    })
                    print(f"[OCR] Overlay item: '{name}' = {price}")

    return items


def detect_tabular_format(text):
    """
    Detect if receipt has tabular format with columns like:
    DESCRIZIONE | IVA | PREZZO
    """
    # Common column headers in different languages
    header_patterns = [
        r'descrizione.*(?:iva|vat).*(?:prezzo|price|importo)',
        r'item.*(?:tax|vat).*(?:price|amount)',
        r'product.*(?:tax).*(?:price)',
        r'articolo.*(?:iva).*(?:prezzo)',
    ]

    text_lower = text.lower()
    for pattern in header_patterns:
        if re.search(pattern, text_lower):
            return True
    return False


def extract_tabular_items(text):
    """
    Extract items from tabular receipt format.
    Handles format: DESCRIPTION | VAT% | PRICE
    """
    items = []
    lines = text.split('\n')

    # Find where item section starts (after header) and ends (before totals)
    in_items_section = False

    # Patterns to identify section boundaries
    header_pattern = re.compile(r'descrizione|item|product|articolo', re.IGNORECASE)
    end_patterns = [
        r'^\s*(?:sub\s*)?totale',
        r'^\s*total',
        r'^\s*importo',
        r'^\s*pagamento',
        r'^\s*contant[ei]',
        r'^\s*carta',
        r'^\s*di cui iva',
    ]

    # Skip patterns for non-item lines
    skip_patterns = [
        r'^descrizione|^item|^product|^articolo',  # Header row
        r'^iva\s|^vat\s|^prezzo|^price',  # Column headers
        r'^\s*$',  # Empty lines
        r'^\d{2}[\/\-\.]\d{2}',  # Dates
        r'^documento|^scontrino',  # Document info
    ]

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Check if we've hit header row - start looking for items after this
        if header_pattern.search(line) and not in_items_section:
            in_items_section = True
            continue

        # Check if we've hit end of items section
        if any(re.match(p, line, re.IGNORECASE) for p in end_patterns):
            in_items_section = False
            continue

        # Skip header/meta lines
        if any(re.search(p, line, re.IGNORECASE) for p in skip_patterns):
            continue

        # Try to extract item from this line
        # Pattern: NAME + optional VAT% + PRICE
        # Examples:
        #   "10UOVA M SENZA ANTIB    10%    2,79"
        #   "NEO BISC.V. CACAO VAN    10%    0,95"

        # Match: text + optional percentage + price at end
        # Price pattern: digits with comma or dot as decimal (EU format)
        match = re.match(
            r'^(.+?)\s+(\d{1,2}%?)?\s*(\d{1,3}\s*[.,]\s*\d{2})\s*$',
            line
        )

        if match:
            name = match.group(1).strip()
            price_str = match.group(3).replace(' ', '')  # Handle "1, 99" -> "1,99"
            price = parse_price(price_str)

            # Clean up name - remove leading markers/quantities
            name = re.sub(r'^[\dX\+\*\-]+\s*', '', name)
            # Remove trailing VAT percentage if stuck to name
            name = re.sub(r'\s+\d{1,2}%\s*$', '', name)
            name = name.strip()

            if name and len(name) >= 2 and 0 < price < 10000:
                items.append({
                    'name': name,
                    'quantity': 1,
                    'price': price,
                    'category': 'Other'
                })
                print(f"[OCR] Tabular item: '{name}' = {price}")

    return items


def normalize_text_for_item_lines(text):
    """Create line boundaries when OCR returns one long block without newlines."""
    if not text:
        return text

    normalized = text

    # Keep the item section when a receipt header marker is present.
    header_match = re.search(r'(descrizione|description|item|articolo)\b', normalized, re.IGNORECASE)
    if header_match:
        normalized = normalized[header_match.end():].strip()

    # Put weighted-price segments on dedicated lines so they can be skipped cleanly.
    normalized = re.sub(
        r'\s+(Net\s+\d+[.,]\d+\s*kg\s*x\s*\d{1,3}\s*[.,]\s*\d{2}\s*(?:EUR/kg|€/kg)?)',
        r'\n\1',
        normalized,
        flags=re.IGNORECASE
    )

    newline_count = normalized.count('\n')
    if newline_count >= 4:
        return normalized

    # Split after prices when next token looks like a new product label.
    normalized = re.sub(
        r'(\d{1,3}\s*[.,]\s*\d{2})\s+(?=[A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý0-9./ -]{1,})',
        r'\1\n',
        normalized
    )

    # Split after common weighted-price trailing markers.
    normalized = re.sub(
        r'(EUR/kg|€/kg)\s+(?=[A-ZÀ-ÖØ-Ý])',
        r'\1\n',
        normalized,
        flags=re.IGNORECASE
    )

    return normalized


def is_noise_item_name(name):
    """Detect OCR fragments that should not become line items."""
    if not name:
        return True

    normalized = re.sub(r'\s+', ' ', name).strip().lower()
    noise_patterns = [
        r'^net\b',
        r'^pz\b',
        r'eur/kg',
        r'^x$',
        r'^\d+[.,]\d+$',
        r'^(?:iva|vat|totale|total)$',
    ]
    return any(re.search(pattern, normalized) for pattern in noise_patterns)


def line_items_quality_score(items, expected_total=0):
    """Score line-item candidates and prefer sets with realistic product names."""
    if not items:
        return float('-inf')

    score = 0.0
    seen_names = set()
    valid_names = 0
    noise_names = 0
    sum_prices = 0.0

    for item in items:
        name = (item or {}).get('name', '') or ''
        price = parse_price((item or {}).get('price', 0))
        normalized_name = re.sub(r'\s+', ' ', name).strip().lower()

        if price > 0:
            sum_prices += price
            score += 0.8
        else:
            score -= 1.5

        if normalized_name and normalized_name not in seen_names:
            seen_names.add(normalized_name)
            score += 0.3
        elif normalized_name:
            score -= 0.4

        has_letters = bool(re.search(r'[A-Za-zÀ-ÖØ-öø-ÿ]', name))
        if has_letters and len(name.strip()) >= 3:
            valid_names += 1
            score += 1.2
        else:
            score -= 1.0

        if is_noise_item_name(name):
            noise_names += 1
            score -= 2.0

    score += min(len(items), 25) * 0.5

    if expected_total and expected_total > 0 and sum_prices > 0:
        deviation = abs(sum_prices - expected_total) / max(expected_total, 1)
        score += max(-3.0, 3.0 - (deviation * 8.0))

    if noise_names >= max(2, len(items) // 2):
        score -= 3.0

    if valid_names == 0:
        score -= 5.0

    return score


def choose_best_line_items(overlay_items, text_items, expected_total=0):
    """Choose between overlay and text line items using quality scoring."""
    if overlay_items and not text_items:
        return overlay_items
    if text_items and not overlay_items:
        return text_items
    if not overlay_items and not text_items:
        return []

    overlay_score = line_items_quality_score(overlay_items, expected_total)
    text_score = line_items_quality_score(text_items, expected_total)
    print(f"[OCR] Line-item scores overlay={overlay_score:.2f}, text={text_score:.2f}")

    # Slight bias to text parser because overlay is prone to weighted-price noise.
    if text_score >= overlay_score - 0.2:
        return text_items
    return overlay_items


def extract_line_items_from_text(text):
    """Extract line items from plain text"""
    text = normalize_text_for_item_lines(text)

    # First, check if this is a tabular receipt
    if detect_tabular_format(text):
        print("[OCR] Detected tabular receipt format")
        items = extract_tabular_items(text)
        if items:
            return items
        # Fall through to standard parsing if tabular extraction fails

    items = []
    lines = text.split('\n')

    skip_patterns = [
        r'^total|^subtotal|^tax',
        r'^iva(?:\s*$|\s+\d{1,2}%\s+\d)',
        r'^vat(?:\s*$|\s+\d{1,2}%\s+\d)',
        r'^thank|^grazie|^merci',
        r'^\d{5,}$',
        r'^change|^cash|^card|^visa|^mastercard',
        r'^pagamento|^contant|^importo pagato',
        r'^documento|^scontrino',
        r'^di cui iva',
        r'^net\s+\d',
    ]

    for line in lines:
        line = line.strip()
        if not line or len(line) < 3:
            continue

        # Some Italian receipts put "IVA EURO" as a header prefix on the first item line.
        line = re.sub(r'^\s*(?:iva|vat)\s+(?:euro|eur)\s+', '', line, flags=re.IGNORECASE)

        should_skip = any(re.search(p, line, re.IGNORECASE) for p in skip_patterns)
        if should_skip:
            continue

        # Match price at end of line (handles both 2,79 and 2.79 formats)
        price_match = re.search(r'(\d{1,3}\s*[.,]\s*\d{2})\s*$', line)
        if price_match:
            price_str = price_match.group(1).replace(' ', '')
            price = parse_price(price_str)

            name = line[:price_match.start()].strip()
            # Remove leading markers/quantities
            name = re.sub(r'^[X\+\*\-\d]+\s*', '', name)
            # Remove embedded VAT percentages
            name = re.sub(r'\s+\d{1,2}%\s*', ' ', name)
            name = name.strip()

            if name and len(name) >= 2 and 0 < price < 10000 and not is_noise_item_name(name):
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

    # FIRST: Try template-based extraction (most accurate when template matches)
    template = match_template(raw_text)
    if template:
        result = extract_with_template(raw_text, template)
        # If template extraction got items, return it
        if result['lineItems'] or result['total'] > 0:
            print(f"[OCR] Using template result: {len(result['lineItems'])} items, total={result['total']}")
            return result
        print("[OCR] Template matched but extraction failed, falling back to generic")

    # SECOND: Generic extraction
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

    overlay_merchant = None
    overlay_total = 0
    overlay_items = []

    # Try overlay-based extraction (more accurate when OCR boxes are clean)
    if text_overlay:
        overlay_merchant = extract_merchant_from_overlay(text_overlay)
        overlay_total = extract_total_from_overlay(text_overlay)
        overlay_items = extract_line_items_from_overlay(text_overlay)

    # Merchant: prefer overlay only when it is meaningful.
    text_merchant = extract_merchant_from_text(raw_text)
    if overlay_merchant and is_valid_merchant_name(overlay_merchant):
        result['merchant'] = overlay_merchant
    elif text_merchant:
        result['merchant'] = text_merchant
    else:
        result['merchant'] = 'Unknown Merchant'

    # Keep overlay total when found, otherwise fallback later.
    result['total'] = overlay_total if overlay_total > 0 else 0

    # Extract date
    result['date'] = extract_date_from_text(raw_text) or datetime.now().isoformat()

    # Compare overlay and text item extraction; choose the better candidate.
    text_items = extract_line_items_from_text(raw_text)
    result['lineItems'] = choose_best_line_items(overlay_items, text_items, result['total'])

    # Fallback for total
    if result['total'] == 0:
        total_patterns = [
            r'(?:totale\s+complessivo|totale\s+eur|total|totale|grand total|amount due|balance)[:\s]*[$€£]?\s*(\d+[.,]\s?\d{2})',
        ]
        for pattern in total_patterns:
            match = re.search(pattern, raw_text, re.IGNORECASE)
            if match:
                result['total'] = parse_price(match.group(1).replace(' ', ''))
                break

    # If explicit total is missing, use the item sum for multi-item receipts.
    if result['total'] == 0 and len(result['lineItems']) >= 2:
        sum_items = round(sum(parse_price(item.get('price', 0)) for item in result['lineItems']), 2)
        if sum_items > 0:
            result['total'] = sum_items

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

    def _set_cors_headers(self):
        origin = self.headers.get('Origin')
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS, GET')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Vary', 'Origin')

    def _forbidden_origin(self):
        self.send_response(403)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Vary', 'Origin')
        self.end_headers()
        self.wfile.write(json.dumps({'error': 'Origin not allowed'}).encode())

    def do_OPTIONS(self):
        if not is_origin_allowed(self.headers.get('Origin'), self.headers.get('Host')):
            self._forbidden_origin()
            return

        self.send_response(204)
        self._set_cors_headers()
        self.end_headers()

    def do_GET(self):
        if not is_origin_allowed(self.headers.get('Origin'), self.headers.get('Host')):
            self._forbidden_origin()
            return

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self._set_cors_headers()
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
            if not is_origin_allowed(self.headers.get('Origin'), self.headers.get('Host')):
                self._forbidden_origin()
                return

            client_id = get_client_identifier(self.headers)
            if is_rate_limited(client_id):
                self.send_error_response(429, 'Too many OCR requests. Please try again later.')
                return

            content_length = int(self.headers.get('Content-Length', 0))
            if content_length <= 0:
                self.send_error_response(400, 'Request body is required')
                return

            if content_length > MAX_REQUEST_BYTES:
                self.send_error_response(413, 'Request payload too large')
                return

            body = self.rfile.read(content_length)
            data = json.loads(body.decode('utf-8'))

            file_base64 = data.get('file')
            file_name = data.get('fileName', 'receipt.jpg')
            api_key = data.get('apiKey')

            if not file_base64:
                self.send_error_response(400, 'File is required')
                return

            if not (api_key or OCR_SPACE_SERVER_API_KEY or OCR_SPACE_FREE_KEY):
                self.send_error_response(
                    400,
                    'OCR API key is required. Add one in Settings or configure OCR_SPACE_API_KEY on the server.'
                )
                return

            print(f"[OCR] Processing file: {file_name}")

            try:
                file_data = base64.b64decode(file_base64, validate=True)
            except Exception:
                self.send_error_response(400, 'Invalid base64 file payload')
                return

            if len(file_data) > MAX_REQUEST_BYTES:
                self.send_error_response(413, 'Decoded file is too large')
                return

            result = process_receipt(file_data, file_name, api_key)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()

            self.wfile.write(json.dumps(result).encode())

        except json.JSONDecodeError:
            self.send_error_response(400, 'Invalid JSON payload')
        except Exception as e:
            print(f"[OCR] Error: {e}")
            import traceback
            traceback.print_exc()
            self.send_error_response(500, 'Failed to process receipt')

    def send_error_response(self, status_code, message):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        origin = self.headers.get('Origin')
        if origin and is_origin_allowed(origin, self.headers.get('Host')):
            self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Vary', 'Origin')
        self.end_headers()

        response = {'error': message}
        self.wfile.write(json.dumps(response).encode())
