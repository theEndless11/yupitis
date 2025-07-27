import { setCorsHeaders } from '../lib/cors';
import mysql from '../utils/mysql';
import { addMember } from './members';

export default async function handler(req, res) {
  setCorsHeaders(res, req.headers.origin || '*');

  const userId = req.headers['x-user-id'] ? parseInt(req.headers['x-user-id']) : null;
  const groupId = req.query.id ? parseInt(req.query.id) : null;

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    if (!userId) return res.status(401).json({ error: 'User ID required' });

    if (groupId) {
      // Fetch single group details
      const [groups] = await mysql.query('SELECT * FROM groups WHERE id = ?', [groupId]);
      if (groups.length === 0) return res.status(404).json({ error: 'Group not found' });
      return res.json(groups[0]);
    }

    // Fetch groups joined by user
    const [joinedGroups] = await mysql.query(
      `SELECT g.* FROM groups g
       JOIN members m ON m.groupId = g.id
       WHERE m.userId = ? AND m.status = 'active'
       ORDER BY g.createdAt DESC`, [userId]
    );

    // Fetch groups user has NOT joined or requested (available)
    const [availableGroups] = await mysql.query(
      `SELECT * FROM groups
       WHERE id NOT IN (
         SELECT groupId FROM members WHERE userId = ? AND status = 'active'
       )
       ORDER BY createdAt DESC`, [userId]
    );

    return res.json({ joinedGroups, availableGroups });
  }

  if (req.method === 'POST') {
    // Create new group
    const { name, description, isPrivate } = req.body;
    if (!userId) return res.status(401).json({ error: 'User ID required' });
    if (!name) return res.status(400).json({ error: 'Group name required' });

    const [result] = await mysql.query(
      'INSERT INTO groups (name, description, isPrivate, ownerId) VALUES (?, ?, ?, ?)',
      [name.trim(), description || '', isPrivate ? 1 : 0, userId]
    );

    const newGroupId = result.insertId;
    await addMember(newGroupId, userId, 'admin', 'active');
    return res.json({ success: true, joinedGroups, availableGroups });
  }
  if (req.method === 'PUT') {
    // Update group info
    if (!groupId) return res.status(400).json({ error: 'Group ID required' });
    const { name, description, avatar } = req.body;
    await mysql.query('UPDATE groups SET name = ?, description = ?, avatar = ? WHERE id = ?', [
      name, description, avatar, groupId
    ]);
    return res.json({ message: 'Group updated' });
  }

  if (req.method === 'DELETE') {
    // Delete group
    if (!groupId) return res.status(400).json({ error: 'Group ID required' });
    await mysql.query('DELETE FROM groups WHERE id = ?', [groupId]);
    return res.json({ message: 'Group deleted' });
  }

  return res.status(405).end();
}


