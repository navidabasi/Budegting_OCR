# Receipt Manager PWA

A Progressive Web App (PWA) for managing receipts and expenses with OCR capabilities using the Veryfi API.

## Features

- 📸 **Receipt Scanning**: Upload images or take photos to extract receipt data using Veryfi OCR
- ✍️ **Manual Entry**: Add receipts manually without OCR
- 📊 **Analytics Dashboard**: View expense trends, category breakdowns, and top merchants
- 🏷️ **Smart Categorization**: Automatic category suggestions based on merchant names
- 💾 **Local Storage**: All data stored locally using IndexedDB
- 📱 **PWA Support**: Installable app with offline capabilities
- 🔐 **User Accounts**: Local authentication with optional Veryfi API key

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn
- A Veryfi API key (optional - you can use the app without it for manual entry)

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

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

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

### Netlify

1. Build the project: `npm run build`
2. Deploy the `dist` folder to Netlify
3. The `public/_redirects` file is already included for SPA routing

### Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` in the project directory
3. Follow the prompts

### GitHub Pages

1. Install `gh-pages`: `npm install --save-dev gh-pages`
2. Add to `package.json`:
```json
"scripts": {
  "deploy": "npm run build && gh-pages -d dist"
}
```
3. Run `npm run deploy`

### Cloudflare Pages

1. Connect your repository to Cloudflare Pages
2. Set build command: `npm run build`
3. Set output directory: `dist`

## Usage

### Creating an Account

1. Click "Sign up" on the login page
2. Enter your email and password
3. Optionally add your Veryfi API key (you can add it later in Settings)
4. Click "Create Account"

### Adding Receipts

1. Tap the green **+** button in the bottom navigation
2. Choose one of three options:
   - **Take Photo**: Capture receipt with camera (requires API key)
   - **Upload Image**: Select image from device (requires API key)
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

Access settings via the Settings icon in the bottom navigation:
- Add or update your Veryfi API key
- Load demo data to see the app in action
- Logout

## Veryfi API Setup

1. Sign up at [veryfi.com](https://www.veryfi.com)
2. Get your API credentials from the dashboard
3. Add them in Settings → Veryfi API Key

**Note**: The free tier has usage limits. Each user provides their own API key to stay within individual limits.

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
- **Chart.js** - Data visualization
- **React Hook Form** - Form handling
- **Veryfi API** - OCR service
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

