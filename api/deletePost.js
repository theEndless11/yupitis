import { promisePool } from '../utils/db'; // MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or specify your domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  // Allowed headers
};

// Serverless API handler for editing or deleting posts
export default async function handler(req, res) {
    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end(); // Respond with 200 OK for OPTIONS pre-flight
    }

    // Set CORS headers for all other requests
    setCorsHeaders(res);

    const { postId, username, sessionId, message, timestamp } = req.body;

    // Validate required fields for DELETE and PUT
    if (!postId || !username || !sessionId) {
        return res.status(400).json({ message: 'Missing required fields: postId, username, sessionId' });
    }

    try {
        // Fetch the post from the database
        const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);

        if (posts.length === 0) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const post = posts[0];

        // Ensure the post belongs to the user making the request
        if (post.username !== username) {
            return res.status(403).json({ message: 'You can only edit or delete your own posts' });
        }

        // Handle DELETE request
        if (req.method === 'DELETE') {
            // Delete the post from the database
            await promisePool.execute('DELETE FROM posts WHERE _id = ?', [postId]);
            return res.status(200).json({ message: 'Post deleted successfully' });
        }

        // Handle PUT (Edit) request
        if (req.method === 'PUT') {
            // Validate the new fields for editing the post
            if (!message || !timestamp) {
                return res.status(400).json({ message: 'Message and timestamp are required to update the post' });
            }

            // Update the post in the database
            await promisePool.execute(
                'UPDATE posts SET message = ?, timestamp = ? WHERE _id = ?',
                [message, timestamp, postId]
            );

            // Fetch the updated post to return
            const [updatedPosts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
            const updatedPost = updatedPosts[0];

            return res.status(200).json({ message: 'Post updated successfully', post: updatedPost });
        }

        // If method is not DELETE or PUT, return Method Not Allowed
        return res.status(405).json({ message: 'Method Not Allowed' });

    } catch (error) {
        console.error('Error handling post edit/delete:', error);
        res.status(500).json({ message: 'Error processing request', error });
    }
}


