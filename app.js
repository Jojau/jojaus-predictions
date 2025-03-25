//ANCHOR - Imports (external)
const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');

const { Server } = require('socket.io');

const { setTimeout } = require("timers/promises");

const bcrypt = require('bcrypt');
const crypto = require("crypto");
const randomId = () => crypto.randomBytes(8).toString("hex");

const StreamerbotClient = require('@streamerbot/client').StreamerbotClient;

// ANCHOR IMPORTS (internal)
const { InMemorySessionStore } = require("./sessionStore");
const sessionStore = new InMemorySessionStore();

// ANCHOR INITIALISE SERVERS
const app = express();
const server = createServer(app);
const io = new Server(server);
const streamerBotClient = new StreamerbotClient();

const PORT = process.env.PORT || 3000;

//ANCHOR - Variables
var number = 0;
var users = [];
var currentPredictions = []
var useFixedOdds = true;

//ANCHOR - Routes
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

    // Mot de passe hashé
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

// ANCHOR FUNCTION - CALCULATE ODDS
function calculateOdds(prediction) {
    const outcomes = prediction.data.outcomes;

    const totalPoints = outcomes.reduce((total, outcome) => {
        const outcomeSum = (outcome.betters || []).reduce((sum, better) => sum + better.points, 0);
        return total + outcomeSum;
    }, 0);

    outcomes.forEach(outcome => {
        const outcomePoints = (outcome.betters || []).reduce((sum, better) => sum + better.points, 0);
        outcome.totalPoints = outcomePoints;

        outcome.fixedOdds ??= outcomes.length;
        outcome.chatOdds = outcomePoints > 0 ? parseFloat((totalPoints / outcomePoints).toFixed(2)) : 0;

        outcome.odds = useFixedOdds ? outcome.fixedOdds : outcome.chatOdds;
    });

    return prediction;
}

//SECTION - Main Socket
// ANCHOR PERSISTENT SESSIONS
io.use((socket, next) => {
    const sessionID = socket.handshake.auth.sessionID;
    if (sessionID) {
        const session = sessionStore.findSession(sessionID);
        if (session) {
            socket.sessionID = sessionID;
            socket.userID = session.userID;
            socket.username = session.username;
            socket.points = session.points;
            return next();
        }
    }
    socket.sessionID = randomId();
    socket.userID = randomId();
    socket.username = 'Guest' + number;
    socket.points = 300;
    next();
});

io.on('connect', (socket) => {

    // ANCHOR FUNCTION - GET POINTS
    function getPoints(user) {
        user.points += 10;
        saveUser(user);
        io.to(socket.id).emit('setPoints', { points: user.points });
    }

    // ANCHOR FUNCTION - SAVE USER
    function saveUser(user) {
        sessionStore.saveSession(socket.sessionID, {
            userID: user.userID,
            username: user.username,
            points: user.points,
        });
    }

    // ANCHOR - INITIALISATION
    // emit session details
    socket.emit("session", {
        sessionID: socket.sessionID,
        userID: socket.userID,
    });
    var user = {
        userID: socket.userID,
        username: socket.username,
        points: socket.points,
    };
    saveUser(user);
    io.to(socket.id).emit('setUsername', { username: user.username });
    io.to(socket.id).emit('setPoints', { points: user.points });
    const userIndex = users.findIndex(arrayUser => arrayUser.userID === user.userID);
    if (userIndex == -1) {
        // If the user isn't already present in the users array, we add it
        users.push(user);
        number++;
        const intervalID = setInterval(getPoints, 300000, user);
    }
    io.to(socket.id).emit("updateMode", { useFixedOdds: useFixedOdds });
    io.to(socket.id).emit("displayCurrentPredictions", { currentPredictions: currentPredictions });
    io.to(socket.id).emit("updateLeaderboard", { users: users });


    // SECTION EVENTS
    // ANCHOR - CHANGING USERNAME
    socket.on("changeUsername", (data) => {
        user.username = data.username;
        saveUser(user);
        io.to(socket.id).emit("setUsername", { username: user.username });
        io.local.emit("updateLeaderboard", { users: users });
    })

    // ANCHOR PLACING BET
    socket.on("placeBet", (data) => {
        let predictionToUpdate = currentPredictions.find(prediction => {
            return prediction.name === data.prediction.name;
        });
        if (predictionToUpdate.status != "open" && predictionToUpdate.status != "closing-soon") {
            return;
        }

        if (user.points < Number(data.betValue)) {
            return;
        }
        user.points -= Number(data.betValue);
        saveUser(user);
        io.to(socket.id).emit('setPoints', { points: user.points });

        const userBetIndex = (predictionToUpdate.data.outcomes[data.outcomeId].betters || []).findIndex(arrayBetter => arrayBetter.user.userID === user.userID);
        if (userBetIndex > -1) {
            // If the user already had a bet, we update it            
            predictionToUpdate.data.outcomes[data.outcomeId].betters[userBetIndex].points += Number(data.betValue);
        } else {
            // We add the user to the betters array (or we create it if it didn't exist)
            (predictionToUpdate.data.outcomes[data.outcomeId].betters ||= []).push({
                user: user,
                points: Number(data.betValue)
            });
        }
        calculateOdds(predictionToUpdate);
        io.local.emit("displayCurrentPredictions", { currentPredictions: currentPredictions })
    })

    // ANCHOR PREDICTION CANCELLED (Getting points back)
    socket.on("predictionCancelled", (data) => {
        // TODO ENVOYER DIRECTOS AU MAIN SOCKET SANS PASSER PAR LE FRONT        
        data.cancelledPrediction.data.outcomes.forEach(outcome => {
            (outcome.betters || []).forEach(better => {
                if (better.user.userID === user.userID) {
                    user.points += Number(better.points);
                    saveUser(user);
                    io.to(socket.id).emit('setPoints', { points: user.points });
                }
            });
        });
    });

    // ANCHOR PREDICTION VALIDATED
    socket.on('predictionValidated', (data) => {
        let validatedOutcome = data.validatedPrediction.data.outcomes[Number(data.validatedOutcomeIndex)];
        (validatedOutcome.betters || []).forEach(better => {
            if (better.user.userID === user.userID) {
                user.points += Number(better.points) * Number(validatedOutcome.odds);
                saveUser(user);
                io.to(socket.id).emit('setPoints', { points: user.points });
            }
        });
        io.local.emit("updateLeaderboard", { users: users });
    })
    // !SECTION

    // ANCHOR DISCONNECTION
    socket.on("disconnect", () => {
        users.splice(users.findIndex(arrayUser => arrayUser.userID === user.userID), 1);
    });
});
//!SECTION

// SECTION Admin Socket
const adminNamespace = io.of("/admin");
adminNamespace.use((socket, next) => {
    // TODO ensure the user has sufficient rights
    next();
});
adminNamespace.on("connection", socket => {
    socket.emit("displayCurrentPredictions", { currentPredictions: currentPredictions })
    io.local.emit("updateMode", { useFixedOdds: useFixedOdds });

    // ANCHOR SWITCH MODE
    socket.on("switchMode", (data) => {
        useFixedOdds = !useFixedOdds;
        console.log("Mode switched to " + useFixedOdds ? 'fixed odds' : 'chat odds');
        io.local.emit("updateMode", { useFixedOdds: useFixedOdds });

        currentPredictions.forEach(prediction => {
            calculateOdds(prediction);
        });
        io.local.emit("displayCurrentPredictions", { currentPredictions: currentPredictions })
    })

    // ANCHOR START A PREDICTION
    socket.on("startPrediction", (data) => {
        console.log("Started prediction " + data.prediction.name);
        calculateOdds(data.prediction);
        currentPredictions.push(data.prediction);
        io.local.emit("displayCurrentPredictions", { currentPredictions: currentPredictions });

        streamerBotClient.doAction(
            "d564ca82-ec58-499d-aa95-2a31047317f4",
            {
                "predictionName": data.prediction.data.title,
                "predictionOutcomes": data.prediction.data.outcomes.map(item => item.title).join(' / ')
            }
        );
    })

    // ANCHOR SET "CLOSING SOON"
    socket.on("setPredictionClosingSoon", (data) => {
        console.log("Prediction " + data.prediction.name + " closing soon");
        let predictionToSetClosingSoon = currentPredictions.find(prediction => {
            return prediction.name === data.prediction.name;
        });
        predictionToSetClosingSoon.status = 'closing-soon';
        io.local.emit("displayCurrentPredictions", { currentPredictions: currentPredictions });
    })

    // ANCHOR CLOSE
    socket.on("closePrediction", (data) => {
        console.log("Closing prediction " + data.prediction.name);
        let predictionToClose = currentPredictions.find(prediction => {
            return prediction.name === data.prediction.name;
        });
        predictionToClose.status = 'closed';
        io.local.emit("displayCurrentPredictions", { currentPredictions: currentPredictions });
    })

    // ANCHOR CANCEL
    socket.on("cancelPrediction", async (data) => {
        console.log("Cancelled prediction " + data.prediction.name)
        let predictionToCancel = currentPredictions.find(prediction => {
            return prediction.name === data.prediction.name;
        });
        predictionToCancel.status = 'cancelled';
        io.emit("predictionCancelled", { cancelledPrediction: predictionToCancel }); // TODO I'd like to send directly to main socket and not front
        io.local.emit("displayCurrentPredictions", { currentPredictions: currentPredictions });

        await setTimeout(30000);

        currentPredictions.splice(currentPredictions.findIndex(arrayPrediction => arrayPrediction.name === predictionToCancel.name), 1);
        io.local.emit("displayCurrentPredictions", { currentPredictions: currentPredictions });
        console.log("Prediction " + predictionToCancel.name + " removed from current predictions");
    })

    // ANCHOR VALIDATE OUTCOME
    socket.on('validateOutcome', async (data) => {
        console.log("Validated outcome n°" + data.outcomeIndex + " of prediction " + data.prediction.name);
        let predictionToValidate = currentPredictions.find(prediction => {
            return prediction.name === data.prediction.name;
        });
        predictionToValidate.status = 'validated';
        predictionToValidate.data.outcomes[Number(data.outcomeIndex)].validated = true;
        io.emit("predictionValidated", { validatedPrediction: predictionToValidate, validatedOutcomeIndex: data.outcomeIndex }); //TODO Same
        io.local.emit("displayCurrentPredictions", { currentPredictions: currentPredictions });

        await setTimeout(30000);

        currentPredictions.splice(currentPredictions.findIndex(arrayPrediction => arrayPrediction.name === predictionToValidate.name), 1);
        io.local.emit("displayCurrentPredictions", { currentPredictions: currentPredictions });
        console.log("Prediction " + predictionToValidate.name + " removed from current predictions");
    })
});
// !SECTION

//ANCHOR - START SERVER
console.log('app started');
server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
