const crypto = require("crypto");
const { InMemorySessionStore } = require("../services/SessionStore");
const randomId = () => crypto.randomBytes(8).toString("hex");

class MainSocketHandler {
    constructor(socketManager) {
        this.manager = socketManager;
        this.io = socketManager.getIO();
        this.sessionStore = new InMemorySessionStore();
        
        this.initializeMiddleware();
        this.initializeConnection();
    }

    // SECTION User functions
    // ANCHOR Save user session
    saveUser(socket, user) {
        this.sessionStore.saveSession(socket.sessionID, {
            userID: user.userID,
            username: user.username,
            points: user.points,
        });
    }

    // ANCHOR Award 10 points (every 5 minutes)
    incrementWatchPoints(socket, user) {
        user.points = Math.floor(user.points + 10);
        this.saveUser(socket, user);
        this.io.to(socket.id).emit('setPoints', { points: user.points });
    }
    // !SECTION

    // ANCHOR Persistent sessions
    initializeMiddleware() {
        this.io.use((socket, next) => {
            const sessionID = socket.handshake.auth.sessionID;
            if (sessionID) {
                const session = this.sessionStore.findSession(sessionID);
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
            socket.username = 'Guest' + this.manager.number;
            socket.points = 300;
            next();
        });
    }

    initializeConnection() {
        this.io.on('connect', (socket) => {
            this.handleConnection(socket);
        });
    }

    handleConnection(socket) {
        const user = {
            userID: socket.userID,
            username: socket.username,
            points: socket.points,
        };

        this.setupInitialState(socket, user);
        this.setupEventListeners(socket, user);
    }

    // ANCHOR Setup initial state for a connected user
    setupInitialState(socket, user) {
        socket.emit("session", {
            sessionID: socket.sessionID,
            userID: socket.userID,
        });

        this.saveUser(socket, user);
        this.emitInitialState(socket, user);
        
        const userIndex = this.manager.users.findIndex(arrayUser => arrayUser.userID === user.userID);
        if (userIndex === -1) {
            this.manager.users.push(user);
            this.manager.number++;
            const intervalID = setInterval(() => this.incrementWatchPoints(socket, user), 300000);
        }
    }

    // ANCHOR Emit initial state to the connected user
    emitInitialState(socket, user) {
        this.io.to(socket.id).emit('setUsername', { username: user.username });
        this.io.to(socket.id).emit('setPoints', { points: user.points });
        this.io.to(socket.id).emit("updateMode", { useFixedOdds: this.manager.useFixedOdds });
        this.io.to(socket.id).emit("displayCurrentPredictions", { currentPredictions: this.manager.currentPredictions });
        this.io.to(socket.id).emit("updateLeaderboard", { users: this.manager.users });
    }

    // SECTION Events
    // ANCHOR Setup event listeners
    setupEventListeners(socket, user) {
        socket.on("changeUsername", (data) => this.handleChangeUsername(socket, user, data));
        socket.on("placeBet", (data) => this.handlePlaceBet(socket, user, data));
        socket.on("predictionCancelled", (data) => this.handlePredictionCancelled(socket, user, data));
        socket.on("predictionValidated", (data) => this.handlePredictionValidated(socket, user, data));
        socket.on("disconnect", () => this.handleDisconnect(user));
    }

    // ANCHOR Change username
    handleChangeUsername(socket, user, data) {
        user.username = data.username;
        this.saveUser(socket, user);
        this.io.to(socket.id).emit("setUsername", { username: user.username });
        this.io.local.emit("updateLeaderboard", { users: this.manager.users });
        this.io.local.emit("displayCurrentPredictions", { currentPredictions: this.manager.currentPredictions });
    }

    // ANCHOR Place bet
    handlePlaceBet(socket, user, data) {
        let predictionToUpdate = this.manager.currentPredictions.find(prediction => {
            return prediction.name === data.prediction.name;
        });
        
        // Verify bet conditions
        if (predictionToUpdate.status != "open" && predictionToUpdate.status != "closing-soon") {
            return;
        }
        if (Number(data.betValue) < 0 || user.points < Number(data.betValue)) {
            return;
        }

        // Decrement user points
        user.points -= Number(data.betValue);
        this.saveUser(socket, user);
        this.io.to(socket.id).emit('setPoints', { points: user.points });

        // Add bet to prediction
        const userBetIndex = (predictionToUpdate.data.outcomes[data.outcomeId].betters || [])
            .findIndex(arrayBetter => arrayBetter.user.userID === user.userID);

        if (userBetIndex > -1) {
            // If user has already bet on this outcome, increment their bet
            predictionToUpdate.data.outcomes[data.outcomeId].betters[userBetIndex].points += Number(data.betValue);
        } else {
            // Else, add new bet entry
            (predictionToUpdate.data.outcomes[data.outcomeId].betters ||= []).push({
                user: user,
                points: Number(data.betValue)
            });
        }

        this.manager.calculateOdds(predictionToUpdate);
        this.io.local.emit("displayCurrentPredictions", { currentPredictions: this.manager.currentPredictions });
    }

    // ANCHOR Handle prediction cancelled (refund users)
    handlePredictionCancelled(socket, user, data) {
        data.cancelledPrediction.data.outcomes.forEach(outcome => {
            (outcome.betters || []).forEach(better => {
                if (better.user.userID === user.userID) {
                    user.points += Number(better.points);
                    this.saveUser(socket, user);
                    this.io.to(socket.id).emit('setPoints', { points: user.points });
                }
            });
        });
    }

    // ANCHOR Handle prediction validated (give points to winners)
    handlePredictionValidated(socket, user, data) {
        let validatedOutcome = data.validatedPrediction.data.outcomes[Number(data.validatedOutcomeIndex)];
        (validatedOutcome.betters || []).forEach(better => {
            if (better.user.userID === user.userID) {
                user.points = Math.floor(user.points + Number(better.points) * Number(validatedOutcome.odds));
                this.saveUser(socket, user);
                this.io.to(socket.id).emit('setPoints', { points: user.points });
            }
        });
        this.io.local.emit("updateLeaderboard", { users: this.manager.users });
    }
    // !SECTION

    // ANCHOR Disconnection
    handleDisconnect(user) {
        const index = this.manager.users.findIndex(arrayUser => arrayUser.userID === user.userID);
        if (index !== -1) {
            this.manager.users.splice(index, 1);
        }
    }
}

module.exports = { MainSocketHandler };