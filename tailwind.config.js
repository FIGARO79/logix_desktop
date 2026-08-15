/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Segoe UI"', '-apple-system', 'BlinkMacSystemFont', 'Roboto', 'sans-serif'],
                inter: ['"Segoe UI"', 'sans-serif'],
                print: ['Arial', 'Helvetica', 'sans-serif'],
            },
        },
    },
    plugins: [],
}
