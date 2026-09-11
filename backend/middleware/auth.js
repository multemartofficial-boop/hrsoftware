const jwt = require('jsonwebtoken');

const requireAuth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]; // Bearer token
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const requireWorker = (req, res, next) => {
  if (req.user.role !== 'worker') {
    return res.status(403).json({ error: 'Worker access required' });
  }
  
  // For worker routes, ensure they can only access their own data
  const requestedWorkerId = req.params.workerId || req.body.workerId;
  if (requestedWorkerId && requestedWorkerId !== req.user.workerId) {
    return res.status(403).json({ error: 'Access denied: can only access own data' });
  }
  
  next();
};

const requireClient = (req, res, next) => {
  if (req.user.role !== 'client') {
    return res.status(403).json({ error: 'Client access required' });
  }
  next();
};

module.exports = { requireAuth, requireAdmin, requireWorker, requireClient };
