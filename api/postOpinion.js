const ffmpeg = require('fluent-ffmpeg');
const { promisePool } = require('../utils/db');  // Corrected to use MySQL connection pool
const { publishToAbly } = require('../utils/ably');  // Assuming this remains the same
const uuid = require('uuid');
const { Readable } = require('stream');  // Node.js Readable stream module
const Buffer = require('buffer').Buffer;  // To handle binary data

// Set CORS headers
const setCorsHeaders = (req, res) => {
    const allowedOrigins = ['https://latestnewsandaffairs.site'];  // Add more origins if needed
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://latestnewsandaffairs.site');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Cache-Control', 'no-cache');
};

// Handle post actions (creating, liking, disliking)
const handler = async (req, res) => {
    if (req.method === 'OPTIONS') {
        setCorsHeaders(req, res);
        return res.status(200).end();
    }

    setCorsHeaders(req, res);

    // POST: Create new post
    if (req.method === 'POST') {
        const { message, username, sessionId, photo, video } = req.body;

        console.log('Received POST request with body:', req.body);  // Log the body data

        if (!username || !sessionId) {
            return res.status(400).json({ message: 'Username and sessionId are required' });
        }

        if (!message && !photo && !video) {
            return res.status(400).json({ message: 'Post content cannot be empty' });
        }

        try {
            let photoUrl = null;
            let videoData = null;

            // If a photo is provided (either URL or base64 string), save it in the photo column of posts table
            if (photo) {
                console.log('Processing photo data:', photo);  // Log photo data
                photoUrl = photo;  // Just use the photo URL or base64 string
            }

            // If a video is provided (either URL or base64 string), compress and save it in the video column of posts table
            if (video) {
                console.log('Processing video data:', video);  // Log video data

                // Decode the base64 video data to a buffer
                const videoBuffer = Buffer.from(video.split(',')[1], 'base64');

                // Create a readable stream from the buffer
                const videoStream = new Readable();
                videoStream.push(videoBuffer);
                videoStream.push(null);  // End of stream

                // Create a new buffer to hold the compressed video
                const compressedVideoBuffer = await new Promise((resolve, reject) => {
                    const compressedVideoStream = ffmpeg()
                        .input(videoStream)
                        .inputFormat('mp4')  // Input format of the video
                        .videoCodec('libx264')  // Use H.264 for good compression
                        .audioCodec('aac')  // Audio codec (optional)
                        .outputOptions([
                            '-crf 23',  // Constant rate factor, adjust for file size vs quality
                            '-preset veryfast',  // Speed vs compression tradeoff
                            '-max_muxing_queue_size 1024',  // Avoid FFmpeg errors with large files
                            '-threads 2',  // Limit threads for performance
                        ])
                        .on('end', () => {
                            resolve(compressedVideoBuffer);
                        })
                        .on('error', (err) => {
                            console.error('FFmpeg error:', err);
                            reject(err);
                        })
                        .outputFormat('mp4')  // Output format for the compressed video
                        .pipe();  // Pipe the result to a buffer

                    // Capture the output as a buffer
                    const buffers = [];
                    compressedVideoStream.on('data', (chunk) => {
                        buffers.push(chunk);
                    });
                    compressedVideoStream.on('end', () => {
                        const finalBuffer = Buffer.concat(buffers);
                        resolve(finalBuffer);  // Return the final compressed buffer
                    });
                });

                // After compression, the `compressedVideoBuffer` contains the video in binary format
                videoData = compressedVideoBuffer;
            }

            // Insert the new post into MySQL, with photo and video fields holding the URLs or base64 strings
            const [result] = await promisePool.execute(
                'INSERT INTO posts (message, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, photo, video) VALUES (?, NOW(), ?, ?, 0, 0, ?, ?, ?, ?, ?)',
                [message || '', username, sessionId, JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), photoUrl || null, videoData || null]
            );

            const newPost = {
                _id: result.insertId,  // MySQL auto-incremented ID
                message: message || '',  // Ensure empty message is allowed
                timestamp: new Date(),
                username,
                likes: 0,
                dislikes: 0,
                likedBy: [],
                dislikedBy: [],
                comments: [],
                photo: photoUrl,  // Store the photo URL or base64 string
                video: videoData   // Store the compressed video buffer directly in the DB
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


    // PUT/PATCH: Handle likes/dislikes (same as before)
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
};

module.exports = handler;
