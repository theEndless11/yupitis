const { promisePool } = require('../utils/db');  // Corrected to use MySQL connection pool
const { publishToAbly } = require('../utils/ably');  // Assuming this remains the same
const { Storage } = require('@google-cloud/storage');

// Set up Google Cloud Storage using the service account credentials
const storage = new Storage({
  credentials: {
    type: 'service_account',
    project_id: 'verdant-sprite-453307-h6',
    private_key_id: 'f5aa31e6ae8a8e0070e9cb66add2980ea44784f3',
    private_key: `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDWo5Z2fri1OWsU
wzkczrKiC/VqmdobFCv5uJHQzGVtz6Ks+35nFAXofGKteCQVJjTWb7/zxyr/4RYv
QckjE6x7Zd8fHKt3zkF2ckfitezWEKEcHZzdo53bs+B9uhbJjMxxvwWuhVgv2wn5
gfLWU8LvD7frA/zFTzIYrhXRKdTDgXq9uAHugJYWxZTXJiHKerv3Whe2cJDOi/Iy
XtTFgaiwnKwJm9nHll4UIX7LSVqGHxul1RuD1TOJrVu4/2VyypYgm4+4agGnQ0hO
NzXIEtJcNIYHm8pM9W4RoHBVYjZ8k9zVzwolVVsMk1EOJ6oKZPE9K5MVyzkGAWDW
+cYeUK3JAgMBAAECggEAEcNQtMEV/iwgotjpMBYhuGwZmlczMqHVEIHoJ18oVxHO
RQHnMGv6yoZeEDxswrH6a3NXb7r1jF7ksXKAon4tUbpY4GqZ/NHn9FUkLSygdggY
R+BiLAGEveWWrYZUqRzANVBOuGZhVEyMoxvQV1Eamngy4KiK0bVqeu+6mdMcFYsf
IjN8gHDg8G5TO6PAXNvYhbWdr/+w25W+iQE07ud07jNZ06wkCfxBX45mq5Y4gJv/
84OKo7XCHzPH0SSoi4Dra7V94MdM4qaiu6DG4P4rHu0RSDGfFz0+rzlKEODnRczb
JRTdo6GtN2HuiAqj8qhTm5DnW7kPYExytPU82NmsUQKBgQD0k7guHuH9/dlBmu1w
QPuvdzQqvm4oRp+8lLPBsDY/xU2CUVEBLtHwiwCSvANlzPIkKe5gSaUInC4Vf+PK
j7oRbBKvomxqvhbGooYo9FZmcOqRB1ppBDfDpDyQ5BOKdnzfNxv/C0uxtz2Fz6rN
NWHuBBN/iZs5wi4VkIONzyuMDQKBgQDgqeo9Qq0tSJ1b19emKhgaKZt3vabUj1oa
NEgZEondLK82+23Fue91NO75JohU2O8DXrlNLNvcFsVRqjmfoX8s/h/bnt0dm5VC
BCMYGmiinryIzhX1M5RGQukvWF8DD1G+AyRCWZ4hTHBPF5okqECw8RrVUs2ocjtW
6iPhRGftrQKBgCOMzTq29nZqzYeBs32blHnew9BquaxVB6brnm1K5bfDQA7vLu0T
FyT1r3GkroG/lnq3NZT9X2Wu/evWGRA6b/tUUCsDWurxEnJw8TtGuMBPLWlDPlsB
Z/GiD8Onw0dfDauMYR9jTu9YCTNICjWlysREB2mEYPG2TeiIhva35EaJAoGAOdWj
9kc+24Rw9d63pg/6Cmohmo6Y7ulEUbCZytKJ6QUCyg2psZfu++Y3iq4PtH/v75cn
7qUYqCy4eRBwKxbg7U0yGFBqLaAKqWb1PdQ2kX55nGIpJukzR28cJlMCioAcE+Ut
JWN6oKnT05iI1tz1Yld/B+F8DdvySKqXt/rrIjUCgYBFeESR/m2loEiK9r8+Dh39
GI7RHlBRMfgF+aa7x8S0pvafCPT24N5IVT5XXRBwOs37O393wNeCZ9fjGFdVsK8P
LTxV0TgUhJtEHZuEnkHOLuEwbi+7KCHhsEpqFqSH1qD6tplcCL8DhTtdiwOAoYgq
+6NiRdA3gpjUzw2GgNcYUg==
-----END PRIVATE KEY-----`,
    client_email: 'theendless@verdant-sprite-453307-h6.iam.gserviceaccount.com',
    client_id: '103473174867501305577',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/theendless%40verdant-sprite-453307-h6.iam.gserviceaccount.com',
    universe_domain: 'googleapis.com'
  }
});

const bucketName = 'verdant-sprite-453307-h6';  // Use your actual bucket name here

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

// Get signed URL from GCS for video upload
const getSignedUrl = async (fileName) => {
    const file = storage.bucket(bucketName).file(fileName);

    const [url] = await file.getSignedUrl({
        action: 'write',  // 'write' action for uploading
        expires: Date.now() + 15 * 60 * 1000,  // Expires in 15 minutes
        contentType: 'video/mp4',  // Adjust this if necessary based on file type
    });

    return url;
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
        const { message, username, sessionId, video } = req.body;

        console.log('Received POST request with body:', req.body);

        if (!username || !sessionId) {
            return res.status(400).json({ message: 'Username and sessionId are required' });
        }

        if (!message && !video) {
            return res.status(400).json({ message: 'Post content cannot be empty' });
        }

        let videoUrl = null;

        // If a video URL or base64 is provided, save it to GCS
        if (video) {
            try {
                // Get a signed URL for uploading the video
                const fileName = `videos/${Date.now()}-${username}.mp4`;  // Unique name for the video
                const signedUrl = await getSignedUrl(fileName);

                // Here you would need to implement video upload on the frontend using this signed URL
                // Frontend needs to PUT the file to signedUrl
                videoUrl = signedUrl.split('?')[0];  // Return the public URL after uploading
            } catch (error) {
                console.error('Error generating signed URL:', error);
                return res.status(500).json({ message: 'Error uploading video', error });
            }
        }

        // Proceed to insert the new post into the database
        try {
            const [result] = await promisePool.execute(
                'INSERT INTO posts (message, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, video) VALUES (?, NOW(), ?, ?, 0, 0, ?, ?, ?, ?)',
                [message || '', username, sessionId, JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), videoUrl || null]
            );

            const newPost = {
                _id: result.insertId,
                message: message || '',
                timestamp: new Date(),
                username,
                likes: 0,
                dislikes: 0,
                likedBy: [],
                dislikedBy: [],
                comments: [],
                video: videoUrl,
            };

            // Publish to Ably or any real-time service
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
