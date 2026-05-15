const express = require('express');
const path = require('path');

const app = express();
const rootDir = __dirname;

app.use(express.static(rootDir));

app.get('*', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
    console.log(`Frontend escuchando en puerto ${port}`);
});
