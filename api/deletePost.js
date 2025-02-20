import { promisePool } from '../utils/db'; // MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or specify your domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  // Allowed headers
};

// Serverless API handler for editing or deleting a post
export default async function handler(req, res) {
    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end(); // Respond with 200 OK for OPTIONS pre-flight
    }

    // Set CORS headers for all other requests
    setCorsHeaders(res);

    // Log the incoming request body for debugging
    console.log("Received request body:", req.body);

    // Ensure the body is valid JSON and extract necessary fields
    const { postId, username, sessionId, message } = req.body;

    // Check for missing required fields
    if (!postId || !username || !sessionId) {
        return res.status(400).json({ message: 'Missing required fields: postId, username, sessionId' });
    }

    // Check if the message is provided for editing (PUT request)
    if (req.method === 'PUT' && (!message || !message.trim())) {
        return res.status(400).json({ message: 'Post content cannot be empty' });
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

        // Handle PUT (edit) request
        if (req.method === 'PUT') {
            // Update the post with the new message
            await promisePool.execute(
                `UPDATE posts SET message = ?, timestamp = ? WHERE _id = ?`,
                [message, new Date(), postId]
            );

            // Return the updated post as a response
            return res.status(200).json({ message: 'Post updated successfully', postId, newMessage: message });
        }

        // If method is not DELETE or PUT, respond with method not allowed
        return res.status(405).json({ message: 'Method Not Allowed' });

    } catch (error) {
        console.error("Error processing the request:", error);
        res.status(500).json({ message: 'Error processing the request', error });
    }
}


