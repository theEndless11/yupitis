import { setCorsHeaders } from '../lib/cors';
import mysql from '../utils/mysql';
import { addMember } from './members';

export default async function handler(req, res) {
  setCorsHeaders(res, req.headers.origin || '*');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = parseInt(req.query.userId); // extract userId from query

  // Helper: fetch groups where user is a member
  async function fetchJoinedGroups(userId) {
    const [groups] = await mysql.query(
      `SELECT g.* FROM groups g
       JOIN members m ON m.groupId = g.id
       WHERE m.userId = ? AND m.status = 'active'
       ORDER BY g.createdAt DESC`, [userId]
    );
    return groups;
  }

  // Helper: fetch groups where user is NOT a member
  async function fetchAvailableGroups(userId) {
    const [groups] = await mysql.query(
      `SELECT * FROM groups WHERE id NOT IN (
         SELECT groupId FROM members WHERE userId = ? AND status = 'active'
       ) ORDER BY createdAt DESC`, [userId]
    );
    return groups;
  }

  // Helper: fetch pending join requests by user
  async function fetchPendingRequests(userId) {
    const [requests] = await mysql.query(
      `SELECT id, groupId FROM join_requests WHERE userId = ? AND status = 'pending'`, [userId]
    );
    return requests;
  }

  try {
    if (req.method === 'GET') {
      if (req.query.id) {
        const groupId = parseInt(req.query.id);
        const [groups] = await mysql.query('SELECT * FROM groups WHERE id = ?', [groupId]);
        if (!groups.length) return res.status(404).json({ success: false, error: 'Group not found' });
        return res.json({ success: true, group: groups[0] });
      }

      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId query parameter required' });
      }

      const [joinedGroups, availableGroups, pendingRequests] = await Promise.all([
        fetchJoinedGroups(userId),
        fetchAvailableGroups(userId),
        fetchPendingRequests(userId),
      ]);

      return res.json({
        success: true,
        joinedGroups,
        availableGroups,
        pendingRequests,
      });
    }

    if (req.method === 'POST') {
      const { name, description, isPrivate } = req.body;
      const userIdHeader = req.headers['x-user-id'];
      if (!name) return res.status(400).json({ success: false, error: 'Name required' });
      if (!userIdHeader) return res.status(400).json({ success: false, error: 'User ID header required' });

      const [result] = await mysql.query(
        'INSERT INTO groups (name, description, isPrivate, ownerId) VALUES (?, ?, ?, ?)',
        [name.trim(), description || '', isPrivate || false, userIdHeader]
      );

      const newGroupId = result.insertId;
      await addMember(newGroupId, userIdHeader, 'admin');

      return res.status(201).json({ success: true, id: newGroupId, name });
    }

    if (req.method === 'PUT') {
      const groupId = parseInt(req.query.id);
      if (!groupId) return res.status(400).json({ success: false, error: 'Group id required' });
      const { name, description, avatar } = req.body;
      await mysql.query(
        'UPDATE groups SET name = ?, description = ?, avatar = ? WHERE id = ?',
        [name, description, avatar, groupId]
      );
      return res.json({ success: true, message: 'Group updated' });
    }

    if (req.method === 'DELETE') {
      const groupId = parseInt(req.query.id);
      if (!groupId) return res.status(400).json({ success: false, error: 'Group id required' });
      await mysql.query('DELETE FROM groups WHERE id = ?', [groupId]);
      return res.json({ success: true, message: 'Group deleted' });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
}

