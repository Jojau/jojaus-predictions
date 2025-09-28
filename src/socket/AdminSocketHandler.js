class AdminSocketHandler {
    constructor(socketManager, twitchAPI, mongoDB) {
        this.manager = socketManager;
        this.io = socketManager.getIO();
        this.twitchAPI = twitchAPI;
        this.mongoDB = mongoDB;
        this.adminNamespace = this.io.of("/admin");
        
        this.initializeMiddleware();
        this.initializeConnection();
    }

    initializeMiddleware() {
        this.adminNamespace.use((socket, next) => {
            // TODO ensure the user has sufficient rights
            next();
        });
    }

    initializeConnection() {
        this.adminNamespace.on("connection", (socket) => {
            this.handleConnection(socket);
        });
    }

    handleConnection(socket) {
        this.emitInitialState(socket);
        this.setupEventListeners(socket);
    }

    // ANCHOR Emit initial state
    async emitInitialState(socket) {
        // Send all predictions from database
        try {
            const predictions = await this.mongoDB.getAllPredictions();
            this.io.local.emit("displayAllPredictions", { predictions: predictions });
        } catch (error) {
            console.error('Error fetching predictions:', error);
        }

        // Send current predictions (in progress)
        socket.emit("displayCurrentPredictions", { currentPredictions: this.manager.currentPredictions });

        // Send current mode states
        this.io.local.emit("updateMode", { useFixedOdds: this.manager.useFixedOdds });
        this.io.local.emit("updateTwitch", { useTwitch: this.manager.useTwitch });
    }

    // SECTION Events
    // ANCHOR Setup event listeners
    setupEventListeners(socket) {
        socket.on("switchMode", (data) => this.handleSwitchMode());
        socket.on("switchTwitch", (data) => this.handleSwitchTwitch());
        socket.on("startPrediction", (data) => this.handleStartPrediction(data));
        socket.on("setPredictionClosingSoon", (data) => this.handlePredictionClosingSoon(data));
        socket.on("closePrediction", (data) => this.handleClosePrediction(data));
        socket.on("cancelPrediction", (data) => this.handleCancelPrediction(data));
        socket.on("validateOutcome", (data) => this.handleValidateOutcome(data));
    }

    // ANCHOR Switch mode (between fixed odds and chat odds)
    handleSwitchMode() {
        // Toggle mode and send to socket
        this.manager.useFixedOdds = !this.manager.useFixedOdds;
        console.log("Mode switched to " + (this.manager.useFixedOdds ? 'fixed odds' : 'chat odds'));
        this.io.local.emit("updateMode", { useFixedOdds: this.manager.useFixedOdds });

        // Recalculate odds for all current predictions
        this.manager.currentPredictions.forEach(prediction => {
            this.manager.calculateOdds(prediction);
        });
        this.io.local.emit("displayCurrentPredictions", { currentPredictions: this.manager.currentPredictions });
    }

    // ANCHOR Toggle Twitch integration
    handleSwitchTwitch() {
        this.manager.useTwitch = !this.manager.useTwitch;
        console.log("Twitch " + (this.manager.useTwitch ? 'activated' : 'deactivated'));
        this.io.local.emit("updateTwitch", { useTwitch: this.manager.useTwitch });
    }

    // ANCHOR Start a new prediction
    handleStartPrediction(data) {
        console.log("Started prediction " + data.prediction.name);
        this.manager.calculateOdds(data.prediction);
        this.manager.currentPredictions.push(data.prediction);
        this.io.local.emit("displayCurrentPredictions", { currentPredictions: this.manager.currentPredictions });
        
        if(this.manager.useTwitch) {
            this.twitchAPI.sendAnnouncement(
                "A new prediction started! " + 
                data.prediction.data.title + 
                " (" + data.prediction.data.outcomes.map(item => item.title).join(' / ') + ")"
            );
        }
    }

    // ANCHOR Set a prediction as "closing soon"
    handlePredictionClosingSoon(data) {
        console.log("Prediction " + data.prediction.name + " closing soon");
        let predictionToSetClosingSoon = this.manager.currentPredictions.find(prediction => {
            return prediction.name === data.prediction.name;
        });
        predictionToSetClosingSoon.status = 'closing-soon';
        this.io.local.emit("displayCurrentPredictions", { currentPredictions: this.manager.currentPredictions });
    }

    // ANCHOR Close a prediction
    handleClosePrediction(data) {
        console.log("Closing prediction " + data.prediction.name);
        let predictionToClose = this.manager.currentPredictions.find(prediction => {
            return prediction.name === data.prediction.name;
        });
        predictionToClose.status = 'closed';
        this.io.local.emit("displayCurrentPredictions", { currentPredictions: this.manager.currentPredictions });
    }

    // ANCHOR Cancel a prediction
    async handleCancelPrediction(data) {
        // Set status to "cancelled"
        console.log("Cancelled prediction " + data.prediction.name);
        let predictionToCancel = this.manager.currentPredictions.find(prediction => {
            return prediction.name === data.prediction.name;
        });
        predictionToCancel.status = 'cancelled';

        // Send event to main socket (to refund all bets)
        this.io.emit("predictionCancelled", { cancelledPrediction: predictionToCancel });
        this.io.local.emit("displayCurrentPredictions", { currentPredictions: this.manager.currentPredictions });

        // Wait 30s then remove from current predictions
        await new Promise(resolve => setTimeout(resolve, 30000));

        const index = this.manager.currentPredictions.findIndex(
            arrayPrediction => arrayPrediction.name === predictionToCancel.name
        );
        if (index !== -1) {
            this.manager.currentPredictions.splice(index, 1);
        }
        this.io.local.emit("displayCurrentPredictions", { currentPredictions: this.manager.currentPredictions });
        console.log("Prediction " + predictionToCancel.name + " removed from current predictions");
    }

    // ANCHOR Validate an outcome
    async handleValidateOutcome(data) {
        // Set status to "validated"
        console.log("Validated outcome n°" + data.outcomeIndex + " of prediction " + data.prediction.name);
        let predictionToValidate = this.manager.currentPredictions.find(prediction => {
            return prediction.name === data.prediction.name;
        });
        predictionToValidate.status = 'validated';
        predictionToValidate.data.outcomes[Number(data.outcomeIndex)].validated = true;

        // Save result in database
        await this.mongoDB.addPredictionResult(predictionToValidate.name, Number(data.outcomeIndex));
        
        // Send event to main socket (to give points to winners)
        this.io.emit("predictionValidated", { 
            validatedPrediction: predictionToValidate, 
            validatedOutcomeIndex: data.outcomeIndex 
        });
        this.io.local.emit("displayCurrentPredictions", { currentPredictions: this.manager.currentPredictions });

        // Wait 30s then remove from current predictions
        await new Promise(resolve => setTimeout(resolve, 30000));

        const index = this.manager.currentPredictions.findIndex(
            arrayPrediction => arrayPrediction.name === predictionToValidate.name
        );
        if (index !== -1) {
            this.manager.currentPredictions.splice(index, 1);
        }
        this.io.local.emit("displayCurrentPredictions", { currentPredictions: this.manager.currentPredictions });
        console.log("Prediction " + predictionToValidate.name + " removed from current predictions");
    }
}

module.exports = { AdminSocketHandler };