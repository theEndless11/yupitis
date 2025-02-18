import { promisePool } from '../utils2/db';  // Corrected to use MySQL connection pool
import { publishToAbly } from '../utils2/ably';  // Assuming this remains the same

// Set CORS headers
const setCorsHeaders = (req, res) => {
    const allowedOrigins = ['https://latestnewsandaffairs.site'];  // Corrected the allowed origin
    const origin = req.headers.origin;

    // If the request origin matches one of the allowed origins, set the CORS header
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');  // This allows any origin if needed
    }

    // Allow specific HTTP methods
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    // Allow specific headers, including content-type, which is important for JSON requests
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    // Allow credentials to be sent
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Cache-Control', 'no-cache');
};

// Handle post actions (creating, liking, disliking)
export default async function handler(req, res) {
    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        setCorsHeaders(req, res);
        return res.status(200).end();  // Respond with 200 OK for OPTIONS pre-flight
    }

    setCorsHeaders(req, res);  // Ensure CORS headers are applied to all other requests

    // POST: Create new post
    if (req.method === 'POST') {
        const { message, username, sessionId } = req.body;

        if (!message || message.trim() === '') {
            return res.status(400).json({ message: 'Message cannot be empty' });
        }
        if (!username || !sessionId) {
            return res.status(400).json({ message: 'Username and sessionId are required' });
        }

        try {
            // Insert the new post into MySQL
            const [result] = await promisePool.execute(
                'INSERT INTO posts (message, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments) VALUES (?, NOW(), ?, ?, 0, 0, ?, ?, ?)',
                [message, username, sessionId, JSON.stringify([]), JSON.stringify([]), JSON.stringify([])]
            );

            const newPost = {
                _id: result.insertId,  // MySQL auto-incremented ID
                message,
                timestamp: new Date(),
                username,
                likes: 0,
                dislikes: 0,
                likedBy: [],
                dislikedBy: [],
                comments: []
            };

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

    // PUT/PATCH: Handle likes/dislikes
    if (req.method === 'PUT' || req.method === 'PATCH') {
        const { postId, action, username } = req.body;  // action can be 'like' or 'dislike'

        if (!postId || !action || !username) {
            return res.status(400).json({ message: 'Post ID, action, and username are required' });
        }

        try {
            // Get the post from MySQL
            const [postRows] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
            const post = postRows[0];

            if (!post) {
                return res.status(404).json({ message: 'Post not found' });
            }

            let updatedLikes = post.likes;
            let updatedDislikes = post.dislikes;
            let updatedLikedBy = JSON.parse(post.likedBy);
            let updatedDislikedBy = JSON.parse(post.dislikedBy);

            // Handle the 'like' action
            if (action === 'like') {
                if (updatedLikedBy.includes(username)) {
                    return res.status(400).json({ message: 'You have already liked this post' });
                }
                if (updatedDislikedBy.includes(username)) {
                    updatedDislikes -= 1;
                    updatedDislikedBy = updatedDislikedBy.filter(user => user !== username);
                }
                updatedLikes += 1;
                updatedLikedBy.push(username);
            }

            // Handle the 'dislike' action
            if (action === 'dislike') {
                if (updatedDislikedBy.includes(username)) {
                    return res.status(400).json({ message: 'You have already disliked this post' });
                }
                if (updatedLikedBy.includes(username)) {
                    updatedLikes -= 1;
                    updatedLikedBy = updatedLikedBy.filter(user => user !== username);
                }
                updatedDislikes += 1;
                updatedDislikedBy.push(username);
            }

            // Update the post in MySQL
            await promisePool.execute(
                'UPDATE posts SET likes = ?, dislikes = ?, likedBy = ?, dislikedBy = ? WHERE _id = ?',
                [updatedLikes, updatedDislikes, JSON.stringify(updatedLikedBy), JSON.stringify(updatedDislikedBy), postId]
            );

            const updatedPost = {
                _id: postId,
                message: post.message,
                timestamp: post.timestamp,
                username: post.username,
                likes: updatedLikes,
                dislikes: updatedDislikes,
                comments: JSON.parse(post.comments)
            };

            try {
                await publishToAbly('updateOpinion', updatedPost);
            } catch (error) {
                console.error('Error publishing to Ably:', error);
            }

            return res.status(200).json(updatedPost);
        } catch (error) {
            console.error('Error updating post:', error);
            return res.status(500).json({ message: 'Error updating post', error });
        }
    }

    // Handle other methods
    return res.status(405).json({ message: 'Method Not Allowed' });
}

