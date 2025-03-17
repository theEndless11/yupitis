// Use require instead of import
const { promisePool } = require('../utils/db'); // MySQL connection pool
const { publishToAbly } = require('../utils/ably');  // Assuming this remains the same

// Allowed origins (Update this with your frontend domain)
const allowedOrigins = ['https://latestnewsandaffairs.site', 'http://localhost:3000']; 

// Set CORS headers dynamically
const setCorsHeaders = (req, res) => {
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);  // Set to the request's origin
        res.setHeader('Access-Control-Allow-Credentials', 'true');  // Allow credentials
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');  // Allowed headers
};

// Serverless API handler
module.exports = async function handler(req, res) {
    setCorsHeaders(req, res);

    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // POST: Create new post
    if (req.method === 'POST') {
        const { title, subject, username, sessionId, photo } = req.body;

        // Validate if username and sessionId are provided
        if (!username || !sessionId) {
            return res.status(400).json({ message: 'Username and sessionId are required' });
        }

        // Validate if either title, subject, or photo is provided
        if (!title && !subject && !photo) {
            return res.status(400).json({ message: 'Post content cannot be empty' });
        }

            // Insert the new post into MySQL
            const [result] = await promisePool.execute(
                `INSERT INTO posts (title, subject, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, photo)
                VALUES (?, ?, NOW(), ?, ?, 0, 0, ?, ?, ?, ?, ?)` ,
                [title, subject, username, sessionId, '[]', '[]', '[]', photoUrl]
            );

            const newPost = {
                _id: result.insertId,
                title,
                subject,
                timestamp: new Date(),
                username,
                likes: 0,
                dislikes: 0,
                likedBy: [],
                dislikedBy: [],
                comments: [],
                photo: photoUrl
            };

            // Publish the new post to Ably
            try {
                await publishToAbly('newOpinion', newPost);
            } catch (error) {
                console.error('Error publishing to Ably:', error);
            }

            return res.status(201).json(newPost);
        } catch (error) {
            console.error('Error saving post:', error);
            return res.status(500).json({ message: 'Error saving post', error });
        }
    }

    // Handle unsupported methods
    return res.status(405).json({ message: 'Method Not Allowed' });
};
