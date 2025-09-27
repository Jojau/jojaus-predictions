const { Server } = require('socket.io');

class SocketManager {
    constructor(server) {
        this.io = new Server(server);
        this.users = [];
        this.currentPredictions = [];
        this.useFixedOdds = true;
        this.useTwitch = false;
        this.number = 0;
    }

    getIO() {
        return this.io;
    }

    calculateOdds(prediction) {
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
    
            outcome.odds = this.useFixedOdds ? outcome.fixedOdds : outcome.chatOdds;
        });
    
        return prediction;
    }
}

module.exports = { SocketManager };