/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: {
                    50: '#e6f5f2',
                    100: '#b3e0d4',
                    200: '#80ccb6',
                    300: '#4db798',
                    400: '#1aa37a',
                    500: '#00573f',
                    600: '#004633',
                    700: '#003526',
                    800: '#00241a',
                    900: '#00120d',
                }
            }
        },
    },
    plugins: [],
}

