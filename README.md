# Receipt Manager PWA

A Progressive Web App (PWA) for managing receipts and expenses with OCR capabilities.

## Features

- 📸 **Receipt Scanning**: Upload images or take photos to extract receipt data using OCR
- ✍️ **Manual Entry**: Add receipts manually without OCR
- 📊 **Analytics Dashboard**: View expense trends, category breakdowns, and top merchants
- 🏷️ **Smart Categorization**: Automatic category suggestions based on merchant names
- 💾 **Hybrid Storage**: Local-first with IndexedDB, cloud sync with Supabase
- 📱 **PWA Support**: Installable app with offline capabilities
- 🔐 **User Authentication**: Supabase Auth for secure accounts
- ☁️ **Cloud Sync**: Automatic sync across devices

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn
- A Supabase project (for cloud sync and auth)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Budgeting_OCR
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env.local` file with:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

4. Start the development server:
```bash
npm run dev
```

5. Open your browser and navigate to `http://localhost:5173`

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## PWA Icons

Before deploying, you'll need to add PWA icons:
- `public/pwa-192x192.png` (192x192 pixels)
- `public/pwa-512x512.png` (512x512 pixels)

You can generate these using tools like [PWA Asset Generator](https://github.com/onderceylan/pwa-asset-generator) or create them manually.

## Deployment

### Vercel (Recommended)

1. Connect your GitHub repo to Vercel
2. Add environment variables in Vercel dashboard:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Deploy

### Netlify

1. Build the project: `npm run build`
2. Deploy the `dist` folder to Netlify
3. The `public/_redirects` file is already included for SPA routing

## Usage

### Creating an Account

1. Click "Sign up" on the login page
2. Enter your email and password
3. Click "Create Account"
4. Verify your email (check spam folder)

### Adding Receipts

1. Tap the green **+** button in the bottom navigation
2. Choose one of three options:
   - **Take Photo**: Capture receipt with camera
   - **Upload Image**: Select image from device
   - **Enter Manually**: Type receipt details

### Managing Receipts

- View all receipts on the Receipts page
- Tap a receipt to view details
- Edit or delete receipts from the detail page
- Search receipts by merchant, category, or notes

### Analytics

The Dashboard shows:
- Total expenses and receipt count
- Monthly spending
- Category breakdown (pie chart)
- Expense trends (line chart)
- Top merchants

### Settings

Access settings via the Settings icon:
- Add OCR API key (optional, for higher limits)
- Set default currency
- Cloud sync controls
- Load demo data
- Logout

## OCR Setup

The app uses OCR.Space for receipt text extraction.

### Free Tier (No API Key)
- Works out of the box
- ~500 requests/month
- Good for personal use

### With API Key (Optional)
1. Get a free key at [ocr.space/ocrapi](https://ocr.space/ocrapi)
2. Add it in Settings → OCR API Key
3. 25,000 requests/month

See `OCR_SETUP.md` for more details.

## Demo Data

To see the app with sample data:
1. Go to Settings
2. Click "Load Demo Data"
3. This will add 10 sample receipts across different categories

## Technology Stack

- **React 18** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **React Router** - Routing
- **Zustand** - State management
- **Dexie.js** - IndexedDB wrapper
- **Supabase** - Auth and cloud database
- **Chart.js** - Data visualization
- **React Hook Form** - Form handling
- **OCR.Space API** - OCR service
- **vite-plugin-pwa** - PWA support

## Project Structure

```
src/
├── components/
│   ├── common/       # Reusable UI components
│   ├── dashboard/    # Dashboard charts and cards
│   ├── layout/       # Navigation and layout components
│   └── receipts/     # Receipt-related components
├── pages/            # Page components
├── services/         # API and storage services
├── store/            # State management
└── utils/            # Helper functions and constants

api/
└── ocr-proxy.js      # Vercel serverless function for OCR
```

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
