import { setCorsHeaders } from '../lib/cors';
import mysql from '../utils/mysql';
import { addMember } from './members';

export default async function handler(req, res) {
  setCorsHeaders(res, req.headers.origin || '*');

  const userId = req.headers['x-user-id'] ? parseInt(req.headers['x-user-id']) : null;
  const groupId = req.query.groupId ? parseInt(req.query.groupId) : null;
  const requestId = req.query.requestId ? parseInt(req.query.requestId) : null;

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    // Fetch join requests for a group (admin use)
    if (!groupId) return res.status(400).json({ error: 'Group ID required' });

    const [requests] = await mysql.query(
      'SELECT * FROM join_requests WHERE groupId = ? ORDER BY createdAt DESC',
      [groupId]
    );

    return res.json(requests);
  }

  if (req.method === 'POST') {
    // Create join request
    const { username, avatar } = req.body;
    if (!userId || !groupId) return res.status(400).json({ error: 'User ID and Group ID required' });

    // Check if already member
    const [existingMember] = await mysql.query(
      'SELECT * FROM members WHERE groupId = ? AND userId = ? AND status = "active"',
      [groupId, userId]
    );
    if (existingMember.length) return res.status(400).json({ error: 'Already a member' });

    // Check if request already exists and is pending
    const [existingRequest] = await mysql.query(
      'SELECT * FROM join_requests WHERE groupId = ? AND userId = ? AND status = "pending"',
      [groupId, userId]
    );
    if (existingRequest.length) return res.status(400).json({ error: 'Join request already pending' });

    // Insert new join request
    const [result] = await mysql.query(
      'INSERT INTO join_requests (groupId, userId, username, avatar, status) VALUES (?, ?, ?, ?, "pending")',
      [groupId, userId, username || '', avatar || '']
    );

    return res.status(201).json({ message: 'Join request sent', requestId: result.insertId });
  }

  if (req.method === 'PUT') {
    // Approve or decline join request (admin action)
    if (!requestId) return res.status(400).json({ error: 'Request ID required' });

    const { action } = req.body; // 'approve' or 'decline'
    if (!['approve', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    // Fetch the request
    const [requests] = await mysql.query('SELECT * FROM join_requests WHERE id = ?', [requestId]);
    if (requests.length === 0) return res.status(404).json({ error: 'Join request not found' });

    const request = requests[0];
    if (request.status !== 'pending') return res.status(400).json({ error: 'Request already processed' });

    if (action === 'approve') {
      // Update request status to accepted
      await mysql.query('UPDATE join_requests SET status = "accepted" WHERE id = ?', [requestId]);
      // Add member to group as active
      await addMember(request.groupId, request.userId, 'member', 'active');
      return res.json({ message: 'Join request approved' });
    } else {
      // Decline request
      await mysql.query('UPDATE join_requests SET status = "declined" WHERE id = ?', [requestId]);
      return res.json({ message: 'Join request declined' });
    }
  }

  if (req.method === 'DELETE') {
    // Cancel join request (user action)
    if (!requestId) return res.status(400).json({ error: 'Request ID required' });
    if (!userId) return res.status(401).json({ error: 'User ID required' });

    // Only allow cancel if this request belongs to user and is pending
    const [requests] = await mysql.query(
      'SELECT * FROM join_requests WHERE id = ? AND userId = ? AND status = "pending"',
      [requestId, userId]
    );
    if (requests.length === 0) return res.status(404).json({ error: 'Join request not found or cannot cancel' });

    await mysql.query('DELETE FROM join_requests WHERE id = ?', [requestId]);

    return res.json({ message: 'Join request cancelled' });
  }

  return res.status(405).end();
}
