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
}

module.exports = { MongoDBService: MongoDB };