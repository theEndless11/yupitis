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

// Handle GET requests to fetch posts with pagination
if (req.method === 'GET') {
    const { username_like, start_timestamp, end_timestamp, username, page, limit } = req.query;

    let sqlQuery = 'SELECT _id, title, subject, message, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, photo, video FROM posts';
    let queryParams = [];

    // Pagination logic
    const pageNumber = parseInt(page, 10) || 1;  // Default to page 1
    const pageSize = parseInt(limit, 10) || 5;   // Default to 5 posts per page
    const offset = (pageNumber - 1) * pageSize;

    // Apply username filter if provided
    if (username_like) {
        sqlQuery += ' WHERE username LIKE ?';
        queryParams.push(`%${username_like}%`);
    }

    // Apply timestamp range filter if provided
    if (start_timestamp && end_timestamp) {
        sqlQuery += queryParams.length > 0 ? ' AND' : ' WHERE';
        sqlQuery += ' timestamp BETWEEN ? AND ?';
        queryParams.push(start_timestamp, end_timestamp);
    }

    // Add pagination to the query
    sqlQuery += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    queryParams.push(pageSize, offset);

    try {
        // Fetch posts with the constructed SQL query
        const [posts] = await promisePool.execute(sqlQuery, queryParams);

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
                _id: post._id,  // ✅ No renaming needed, as it's already `_id` in DB
                title: post.title,
                subject: post.subject,
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

        // Fetch total post count for pagination
        const totalPostsQuery = 'SELECT COUNT(*) AS count FROM posts';
        const [totalPostsResult] = await promisePool.execute(totalPostsQuery);
        const totalPosts = totalPostsResult[0].count;
        const hasMorePosts = (pageNumber * pageSize) < totalPosts;

        let response = { posts: formattedPosts, hasMorePosts };

        // Fetch user description if username is provided
        if (username) {
            const descriptionQuery = 'SELECT description FROM users WHERE username = ?';
            const [userDescriptionResult] = await promisePool.execute(descriptionQuery, [username]);
            response.description = userDescriptionResult.length > 0 ? userDescriptionResult[0].description : '';
        }

        return res.status(200).json(response);

    } catch (error) {
        console.error("❌ Error retrieving posts:", error);
        return res.status(500).json({ message: 'Error retrieving posts', error });
    }
}

    // Return 405 for any unsupported methods
    return res.status(405).json({ message: 'Method Not Allowed' });
};

