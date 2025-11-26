require('dotenv').config();

//ANCHOR Imports
// External libraries
const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const bcrypt = require('bcrypt');

// Internal files
const { TwitchAPI } = require('./src/services/TwitchAPI');
const { MongoDB } = require('./src/services/MongoDB');
const { SocketManager } = require('./src/socket/SocketManager');
const { MainSocketHandler } = require('./src/socket/MainSocketHandler');
const { AdminSocketHandler } = require('./src/socket/AdminSocketHandler');

// ANCHOR Initialising server
const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

//ANCHOR Routes
function authentication(req, res, next) {
    const authheader = req.headers.authorization;

    if (!authheader) {
        let err = new Error('You are not authenticated!');
        res.setHeader('WWW-Authenticate', 'Basic');
        err.status = 401;
        return next(err)
    }

    const auth = new Buffer.from(authheader.split(' ')[1],
        'base64').toString().split(':');
    const user = auth[0];
    const pass = auth[1];

    const hashedPassword = '$2b$10$kTFjV9qUYcu6StsQC5z84eMtoxkBqMI0vU1fz5pBG5jGD87T6k69u';

    if (user == 'admin' && bcrypt.compareSync(pass, hashedPassword)) {
        // If Authorized user
        next();
    } else {
        let err = new Error('You are not authenticated!');
        res.setHeader('WWW-Authenticate', 'Basic');
        err.status = 401;
        return next(err);
    }
}

app.use(express.static('public'));
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'public/front.html'));
});
app.get('/admin', authentication, (req, res) => {
    res.sendFile(join(__dirname, 'public/admin.html'));
});

// ANCHOR Initialise services and start server
async function initialise() {
    const mongoDB = new MongoDB();
    await mongoDB.connect().catch(console.error);
    const twitchAPI = new TwitchAPI();

    // Initialise Socket.IO handlers
    const socketManager = new SocketManager(server);
    const mainSocketHandler = new MainSocketHandler(socketManager);
    const adminSocketHandler = new AdminSocketHandler(socketManager, twitchAPI, mongoDB);

    server.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });
}

console.log('app started');
initialise().catch(console.error);
