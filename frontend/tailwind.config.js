module.exports = {
    content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
    theme: {
        extend: {},
    },
    plugins: [
        function ({addVariant}) {
            addVariant("mouse", "@media (hover: hover) and (pointer: fine)");
        },
    ],
};
