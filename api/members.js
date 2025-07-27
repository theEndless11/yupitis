import { setCorsHeaders } from '../lib/cors';
import mysql from '../utils/mysql';

export default async function handler(req, res) {
  setCorsHeaders(res, req.headers.origin || '*');

  const groupId = parseInt(req.query.groupId);
  const userId = parseInt(req.headers['x-user-id']); // Ensure it's parsed

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (isNaN(groupId)) {
    return res.status(400).json({ error: 'Invalid or missing groupId' });
  }

  if (req.method === 'GET') {
    const [members] = await mysql.query('SELECT * FROM members WHERE groupId = ?', [groupId]);
    return res.json(members);
  }

  if (req.method === 'POST') {
    const { username, avatar } = req.body;
    if (!userId || !username) {
      return res.status(400).json({ error: 'userId and username are required' });
    }

    const [existing] = await mysql.query('SELECT * FROM members WHERE groupId = ? AND userId = ?', [groupId, userId]);
    if (existing) return res.status(400).json({ error: 'Already a member' });

    await mysql.query(
      'INSERT INTO members (groupId, userId, username, avatar, role, status) VALUES (?, ?, ?, ?, ?, ?)',
      [groupId, userId, username, avatar || '', 'member', 'active']
    );

    return res.status(201).json({ message: 'Joined group' });
  }

  if (req.method === 'DELETE') {
    const targetId = parseInt(req.query.userId);
    if (isNaN(targetId)) {
      return res.status(400).json({ error: 'Invalid userId for deletion' });
    }

    await mysql.query('DELETE FROM members WHERE groupId = ? AND userId = ?', [groupId, targetId]);
    return res.json({ message: 'Member removed' });
  }

  return res.status(405).end();
}

// Helper
export const addMember = async (groupId, userId, role = 'member') => {
  return mysql.query('INSERT INTO members (groupId, userId, role, status) VALUES (?, ?, ?, ?)', [groupId, userId, role, 'active']);
};

