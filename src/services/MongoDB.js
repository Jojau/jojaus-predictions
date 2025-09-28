const { MongoClient } = require('mongodb');

class MongoDB {
    constructor() {
        this.client = null;
        this.db = null;
    }

    async connect() {
        try {
            if (this.client) {
                console.log('MongoDB is already connected');
                return;
            }

            this.client = new MongoClient(process.env.MONGODB_URI);
            await this.client.connect();
            this.db = this.client.db('predictions_db');
            
            console.log('Connected to MongoDB');
        } catch (error) {
            console.error('MongoDB connection error:', error);
            throw error;
        }
    }

    getDb() {
        return this.db;
    }

    async disconnect() {
        try {
            if (this.client) {
                await this.client.close();
                this.client = null;
                this.db = null;
                console.log('Disconnected from MongoDB');
            }
        } catch (error) {
            console.error('Error disconnecting from MongoDB:', error);
            throw error;
        }
    }

    async getAllPredictions() {
        try {
            const predictions = await this.db.collection('predictions').find({}).toArray();
            return predictions;
        } catch (error) {
            console.error('Error fetching predictions:', error);
            throw error;
        }
    }

    async addPredictionResult(predictionId, validatedOutcomeId) {
        try {
            const result = await this.db.collection('results').insertOne({
                predictionId: predictionId,
                outcomeId: validatedOutcomeId,
                timestamp: new Date()
            });
            return result;
        } catch (error) {
            console.error('Error adding prediction result:', error);
            throw error;
        }
    }
}

module.exports = { MongoDB };