import { setCorsHeaders } from '../lib/cors';
import mysql from '../utils/mysql';
import { addMember } from './members';

export default async function handler(req, res) {
  setCorsHeaders(res, req.headers.origin || '*');

  const userId = req.headers['x-user-id'] ? parseInt(req.headers['x-user-id']) : null;
  const groupId = req.query.id ? parseInt(req.query.id) : null;

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET groups

  if (req.method === 'GET') {
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID required' });
    }

    if (groupId) {
      const [groups] = await mysql.query('SELECT * FROM groups WHERE id = ?', [groupId]);
      if (groups.length === 0) {
        return res.status(404).json({ success: false, error: 'Group not found' });
      }
      return res.json({ success: true, group: groups[0] });
    }

    // Fetch joined groups
    const [joinedGroups] = await mysql.query(
      `SELECT g.* FROM groups g
       JOIN members m ON m.groupId = g.id
       WHERE m.userId = ? AND m.status = 'active'
       ORDER BY g.createdAt DESC`,
      [userId]
    );

    let availableGroups = [];

    if (joinedGroups.length === 0) {
      // User not part of any groups — fetch any 5 latest groups
      const [fallbackGroups] = await mysql.query(
        `SELECT * FROM groups
         ORDER BY createdAt DESC
         LIMIT 5`
      );
      availableGroups = fallbackGroups;
    } else {
      // Fetch groups not joined by the user
      const [nonMemberGroups] = await mysql.query(
        `SELECT * FROM groups
         WHERE id NOT IN (
           SELECT groupId FROM members WHERE userId = ? AND status = 'active'
         )
         ORDER BY createdAt DESC`,
        [userId]
      );
      availableGroups = nonMemberGroups;
    }
    return res.json({ success: true, joinedGroups, availableGroups });
  }

  // POST create group
  if (req.method === 'POST') {
    const { name, description, isPrivate } = req.body;
    if (!userId) return res.status(401).json({ error: 'User ID required' });
    if (!name) return res.status(400).json({ error: 'Group name required' });

    const [result] = await mysql.query(
      'INSERT INTO groups (name, description, isPrivate, ownerId) VALUES (?, ?, ?, ?)',
      [name.trim(), description || '', isPrivate ? 1 : 0, userId]
    );

    const newGroupId = result.insertId;

    // Automatically add creator as an admin member
    await addMember(newGroupId, userId, 'admin', 'active');

    // Optionally re-fetch joined/available groups if needed
    return res.json({ success: true, groupId: newGroupId });
  }

  // PUT update group
  if (req.method === 'PUT') {
    if (!groupId) return res.status(400).json({ error: 'Group ID required' });

    const { name, description, avatar } = req.body;

    await mysql.query(
      'UPDATE groups SET name = ?, description = ?, avatar = ? WHERE id = ?',
      [name, description, avatar, groupId]
    );

    return res.json({ message: 'Group updated' });
  }

  // DELETE group
  if (req.method === 'DELETE') {
    if (!groupId) return res.status(400).json({ error: 'Group ID required' });

    await mysql.query('DELETE FROM groups WHERE id = ?', [groupId]);

    return res.json({ message: 'Group deleted' });
  }

  // Method not allowed
  return res.status(405).end();
}

