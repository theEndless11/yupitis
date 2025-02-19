// utils/ably.js
const Ably = require('ably');

// Your Ably API key
const ably = new Ably.Realtime('tpvrng.7-V-wA:ar2W4S8_YZX4IlF7XSLcjt2OYIt0ES8ACPL5kpiujq0');  // Replace with your API key

// Function to publish to a specific Ably channel
function publishToAbly(event, data) {
  const channel = ably.channels.get('Root');  // Replace with the dynamic channel name
  return channel.publish(event, data);
}

// Export the function
module.exports = { publishToAbly };
