// Use require instead of import
const { promisePool } = require('../utils/db'); // MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or specify your domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  // Allowed headers
};

// Serverless API handler for posts, profile pictures, and user descriptions
module.exports = async function handler(req, res) {
    setCorsHeaders(res);

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end(); // End the request immediately after sending a response for OPTIONS
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

    try {
        let profilePicture = 'https://latestnewsandaffairs.site/public/pfp2.jpg'; // Default profile picture

        // Fetch profile picture from the database
        const [userResult] = await promisePool.execute(
            'SELECT profile_picture FROM users WHERE username = ? LIMIT 1',  // Assuming profile picture is stored in the 'users' table
            [username]
        );

        if (userResult.length > 0 && userResult[0].profile_picture) {
            profilePicture = userResult[0].profile_picture;
        }

        let photoUrl = photo || null;  // If no photo is provided, set to null

        // Insert the new post into MySQL
        const [result] = await promisePool.execute(
            `INSERT INTO posts (title, subject, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, photo, profile_picture)
            VALUES (?, ?, NOW(), ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
            [title, subject, username, sessionId, '[]', '[]', '[]', photoUrl, profilePicture]
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
            photo: photoUrl,
            profilePicture
        };

        // Publish the new post to Ably
        try {
            await publishToAbly('newOpinion', newPost);
        } catch (error) {
            console.error('Error publishing to Ably:', error);
        }

        return res.status(201).json(newPost);  // Return the newly created post as a response
    } catch (error) {
        console.error('Error saving post:', error);
        return res.status(500).json({ message: 'Error saving post', error });  // Return error if something fails
    }
}
  // Handle unsupported methods
    return res.status(405).json({ message: 'Method Not Allowed' });
};
