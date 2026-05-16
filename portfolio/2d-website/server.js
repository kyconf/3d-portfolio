const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

// This tells the server where your HTML/CSS/JS files are
// server.js lives inside the 2d-website folder, so __dirname IS that folder
app.use(express.static(__dirname));

app.listen(PORT, () => {
    console.log(`🚀 Server is flying at http://localhost:${PORT}`);
});