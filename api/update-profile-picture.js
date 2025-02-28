const { promisePool } = require('../utils/db');  // Corrected to use MySQL connection pool
// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins or set a specific domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS'); // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allowed headers
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // Enable credentials if needed
};

// Function to update the profile picture in the database
const updateProfilePicture = async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === 'POST') {
        const { username, profilePicture } = req.body;  // Assuming profilePicture is a base64 URL or URL string

        if (!username || !profilePicture) {
            return res.status(400).json({ message: 'Username and profile picture are required' });
        }

        try {
            // Update the user's profile picture in the database
            const [result] = await promisePool.execute(
                'UPDATE users SET profile_picture = ? WHERE username = ?',
                [profilePicture, username]
            );

            // If no rows were affected, the user doesn't exist
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'User not found' });
            }

            return res.status(200).json({ message: 'Profile picture updated successfully' });
        } catch (error) {
            console.error('Error updating profile picture:', error);
            return res.status(500).json({ message: 'Error updating profile picture', error });
        }
    } else {
        return res.status(405).json({ message: 'Method not allowed' });
    }
};

module.exports = { updateProfilePicture };
