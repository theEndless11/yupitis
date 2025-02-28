// /api/update-profile-picture.js

const { promisePool } = require('../utils/db');  // Corrected to use MySQL connection pool
const { setCorsHeaders } = require('../utils/cors');  // Assuming you have CORS handler

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
