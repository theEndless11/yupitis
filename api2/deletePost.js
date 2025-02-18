import { promisePool } from '../utils2/db'; // MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or specify your domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  // Allowed headers
};

// Serverless API handler for deleting a post
export default async function handler(req, res) {
    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end(); // Respond with 200 OK for OPTIONS pre-flight
    }

    // Set CORS headers for all other requests
    setCorsHeaders(res);

    const { postId, username, sessionId } = req.body;

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
            return res.status(403).json({ message: 'You can only delete your own posts' });
        }

        // Delete the post from the database
        await promisePool.execute('DELETE FROM posts WHERE _id = ?', [postId]);

        res.status(200).json({ message: 'Post deleted successfully' });

    } catch (error) {
        console.error("Error deleting post:", error);
        res.status(500).json({ message: 'Error deleting post', error });
    }
}
