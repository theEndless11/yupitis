const webpush = require('web-push');

// VAPID keys (Use your actual VAPID keys here)
const vapidKeys = {
  publicKey: 'BCzZq7Wez64cFt9f8l2qks35cVlxq8kPnpG9blgxtCI9Zt5KZywPBv1uW9u4oiAjaQ3dfMQoAlWlHRhAMsmH7vM',
  privateKey: 'faQ5t1nHZTzYxbvqdzRkADvnAtw3i4JH2VgnleW4dqa9',
};

// Set the VAPID keys for web-push
webpush.setVapidDetails(
  'mailto:noname86473@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// In-memory storage for subscriptions (you can replace this with a DB in production)
let pushSubscriptions = [];

// Allowed origins for CORS
const allowedOrigins = ['*', '*']; // Add your allowed origins here

module.exports = async (req, res) => {
  // CORS Pre-flight (OPTIONS) handling
  if (req.method === 'OPTIONS') {
    // Set necessary CORS headers
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins.join(','));
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); // Allow POST and OPTIONS
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); // Allow the Content-Type header
    return res.status(200).end(); // Respond with a 200 OK status to the pre-flight OPTIONS request
  }

  // For other requests, handle the logic for saving subscription and sending notifications
  if (req.method === 'POST') {
    try {
      // Handle save subscription action
      if (req.body.action === 'save-subscription') {
        const subscription = req.body.subscription;
        pushSubscriptions.push(subscription); // Store subscription (in memory, replace with a DB in production)
        return res.status(200).json({ message: 'Subscription saved successfully' });
      }

      // Handle send push notification action
      if (req.body.action === 'send-push-notification') {
        const notificationPayload = {
          title: 'New Post Notification',
          body: 'A new post has been added!',
          icon: 'https://latestnewsandaffairs.site/public/web-app-manifest-192x192.png', // Ensure the icon exists in your project
          badge: 'https://latestnewsandaffairs.site/public/web-app-manifest-192x192.png', // Optional: Badge for notification
        };

        // Send notification to all saved subscriptions
        await Promise.all(
          pushSubscriptions.map((subscription) => {
            return webpush.sendNotification(subscription, JSON.stringify(notificationPayload));
          })
        );

        return res.status(200).json({ message: 'Push notifications sent' });
      }

      // If the action is not recognized
      return res.status(400).json({ message: 'Invalid action' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: 'Error processing the request' });
    }
  } else {
    // Handle other HTTP methods (e.g., GET, PUT, etc.)
    return res.status(405).json({ message: 'Method Not Allowed' });
  }
};

