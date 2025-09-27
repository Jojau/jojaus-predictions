const axios = require('axios');

class TwitchAPI {
    constructor() {
        axios.defaults.headers.common['Authorization'] = process.env.TWITCH_AUTH;
        this.headers = {
            'Client-Id': process.env.TWITCH_CLIENT_ID,
            'Content-Type': 'application/json',
            'Authorization': process.env.TWITCH_AUTH
        }
    }

    sendChatMessage(message) {
        let data = {
            "broadcaster_id": process.env.TWITCH_USER_ID,
            "sender_id": process.env.TWITCH_USER_ID,
            "message": message
        };

        let config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: 'https://api.twitch.tv/helix/chat/messages',
            headers: this.headers,
            data: data
        };

        axios.request(config)
            .then((response) => {
                return response.data.is_sent;
            })
            .catch((error) => {
                console.log(error);
                return false;
            });
    }

    sendAnnouncement(message) {
        let data = {
            "message": message
        };

        let config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: 'https://api.twitch.tv/helix/chat/announcements?broadcaster_id=' + process.env.TWITCH_USER_ID + '&moderator_id=' + process.env.TWITCH_USER_ID,
            headers: this.headers,
            data: data
        };

        axios.request(config)
            .then((response) => {
                return true;
            })
            .catch((error) => {
                console.log(error);
                this.sendChatMessage(message);
            });
    }
}

module.exports = {
    TwitchAPI
};