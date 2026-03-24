const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

// This tells the server where your HTML/CSS/JS files are
app.use(express.static(path.join(__dirname, '2d-website')));

app.listen(PORT, () => {
    console.log(`🚀 Server is flying at http://localhost:${PORT}`);
});