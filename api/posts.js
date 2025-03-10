const { promisePool } = require('../utils/db'); // Use MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS'); 
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); 
    res.setHeader('Access-Control-Allow-Credentials', 'true'); 
};

// Serverless API handler for getting posts
module.exports = async function handler(req, res) {
    setCorsHeaders(res);

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Handle GET requests to fetch posts
    if (req.method === 'GET') {
        try {
            // Fetch posts from the database, sorted by timestamp (newest first)
            const [posts] = await promisePool.execute('SELECT * FROM posts ORDER BY timestamp DESC');

            // Map over the posts and parse necessary fields
            const formattedPosts = posts.map(post => {
                let photoUrl = null;
                let videoUrl = null;

                // Process photo field
                if (post.photo) {
                    if (post.photo.startsWith('http') || post.photo.startsWith('data:image/')) {
                        photoUrl = post.photo;
                    } else {
                        try {
                            photoUrl = `data:image/jpeg;base64,${Buffer.from(post.photo).toString('base64')}`;
                        } catch (err) {
                            console.error("❌ Error processing photo:", err);
                        }
                    }
                }

                // Process video field
                if (post.video) {
                    if (post.video.startsWith('http') || post.video.startsWith('data:video/')) {
                        videoUrl = post.video;
                    } else {
                        try {
                            videoUrl = `data:video/mp4;base64,${Buffer.from(post.video).toString('base64')}`;
                        } catch (err) {
                            console.error("❌ Error processing video:", err);
                        }
                    }
                }

                return {
                       _id: post._id,
                    message: post.message || "",
                    timestamp: post.timestamp,
                    username: post.username,
                    sessionId: post.sessionId,
                    likes: post.likes || 0,
                    dislikes: post.dislikes || 0,
                    likedBy: post.likedBy ? JSON.parse(post.likedBy) : [],
                    dislikedBy: post.dislikedBy ? JSON.parse(post.dislikedBy) : [],
                    comments: post.comments ? JSON.parse(post.comments) : [],
                    photo: photoUrl,
                    video: videoUrl
                };
            });

            return res.status(200).json(formattedPosts);
        } catch (error) {
            console.error("❌ Error retrieving posts:", error);
            return res.status(500).json({ message: 'Error retrieving posts', error });
        }
    }

    // Return 405 for any unsupported methods
    return res.status(405).json({ message: 'Method Not Allowed' });
};

