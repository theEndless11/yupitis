const webpush = require('web-push');

// ✅ Correct VAPID keys (Ensure you generate valid ones using web-push CLI)
const vapidKeys = {
  publicKey: 'BDWFE0AQumcurqzZHQZ1gHnFHCsEneKPhJFEUJ6LX751sVcpCCtgOtgteJd_YdHeHocz-tuMSSyW6TJImgJ1dpI',  // Replace with the new public key
  privateKey: 'wfAWl9DktIq_vce060uMa8bT0bKLp8hokuIAGvaGzoo', // Replace with the new private key
};

// Validate VAPID keys before setting
if (!vapidKeys.publicKey || !vapidKeys.privateKey || vapidKeys.privateKey.length !== 43) {
  console.error('❌ Invalid VAPID Private Key! It must be exactly 32 bytes when decoded.');
  process.exit(1); // Stop execution if keys are invalid
}

// Set VAPID details for web-push
webpush.setVapidDetails(
  'mailto:noname86473@example.com',  // Use a valid email address
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// ✅ In-memory storage for subscriptions (use a database in production)
let pushSubscriptions = [];

// ✅ Allowed origins for CORS (Replace with actual origins)
const allowedOrigins = ['https://latestnewsandaffairs.site', 'http://localhost:3000'];

module.exports = async (req, res) => {
  const origin = req.headers.origin;

  // ✅ CORS Handling
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://latestnewsandaffairs.site'); // Default origin
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // ✅ Handle Pre-flight OPTIONS Request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ✅ Ensure request is JSON
  if (req.method === 'POST' && !req.headers['content-type']?.includes('application/json')) {
    return res.status(400).json({ message: 'Invalid Content-Type. Use application/json' });
  }

  try {
    const { action, subscription } = req.body;

    // ✅ Save Subscription
    if (action === 'save-subscription') {
      if (!subscription) {
        return res.status(400).json({ message: 'Missing subscription object' });
      }
      pushSubscriptions.push(subscription);
      console.log('✅ Subscription saved:', subscription);
      return res.status(200).json({ message: 'Subscription saved successfully' });
    }

    // ✅ Send Push Notification
    if (action === 'send-push-notification') {
      if (pushSubscriptions.length === 0) {
        return res.status(400).json({ message: 'No subscribers to send notifications' });
      }

      const notificationPayload = JSON.stringify({
        title: 'New Post Notification',
        body: 'A new post has been added!',
        icon: 'https://latestnewsandaffairs.site/public/web-app-manifest-192x192.png',
        badge: 'https://latestnewsandaffairs.site/public/badge.png',
      });

        // Log the subscriptions and payload before sending
      console.log('Sending push notification to subscriptions:', pushSubscriptions);
      const notificationResults = await Promise.allSettled(
        pushSubscriptions.map((sub) => {
          console.log('Attempting to send notification to:', sub.endpoint); // Log each endpoint
          return webpush.sendNotification(sub, notificationPayload)
            .catch((err) => {
              console.error('❌ Failed to send notification to:', sub.endpoint, err); // Log failure details
              return err;
            });
        })
      );

      // Filter out failed subscriptions and log the results
      pushSubscriptions = pushSubscriptions.filter((_, index) => notificationResults[index].status === 'fulfilled');
      console.log('Push notification results:', notificationResults);

      console.log('✅ Push notifications sent');
      return res.status(200).json({ message: 'Push notifications sent' });
    }

    // ❌ Invalid Action
    return res.status(400).json({ message: 'Invalid action' });
  } catch (error) {
    console.error('❌ Server error:', error);
    return res.status(500).json({ message: 'Error processing the request', error });
  }
};
