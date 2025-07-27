import { setCorsHeaders } from '../lib/cors';
import mysql from '../utils/mysql';

export default async function handler(req, res) {
  setCorsHeaders(res, req.headers.origin || '*');

  const groupId = parseInt(req.query.groupId);
  const userId = req.headers['x-user-id'];

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const [members] = await mysql.query('SELECT * FROM members WHERE groupId = ?', [groupId]);
    return res.json(members);
  }

  if (req.method === 'POST') {
    const { username, avatar } = req.body;
    const [existing] = await mysql.query('SELECT * FROM members WHERE groupId = ? AND userId = ?', [groupId, userId]);
    if (existing) return res.status(400).json({ error: 'Already a member' });

    await mysql.query('INSERT INTO members (groupId, userId, username, avatar, role) VALUES (?, ?, ?, ?, ?)', [
      groupId, userId, username, avatar, 'member'
    ]);

    return res.status(201).json({ message: 'Joined group' });
  }

  if (req.method === 'DELETE') {
    const targetId = parseInt(req.query.userId);
    await mysql.query('DELETE FROM members WHERE groupId = ? AND userId = ?', [groupId, targetId]);
    return res.json({ message: 'Member removed' });
  }

  return res.status(405).end();
}

// Helper to be imported elsewhere
export const addMember = async (groupId, userId, role = 'member') => {
  return mysql.query('INSERT INTO members (groupId, userId, role) VALUES (?, ?, ?)', [groupId, userId, role]);
};
