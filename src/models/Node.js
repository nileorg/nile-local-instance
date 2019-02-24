module.exports = class Node {
  constructor (db) {
    this.db = db
  }
  async create ({ token, components, information, resource }) {
    const { success } = await this.db.run(`
        INSERT INTO nodes (
        token,
        components,
        information,
        resource,
        active
        ) VALUES
        (?, ?, ?, ?, 0)
    `, [
      token,
      components,
      information,
      resource
    ])
    return success
  }
  async getByToken ({ token }) {
    return this.db.run('SELECT * FROM nodes WHERE token = ?', [token])
  }
  async getById ({ primaryKey }) {
    return this.db.run('SELECT * FROM nodes WHERE node_id = ?', [primaryKey])
  }
  async update ({ components, information, nodeId }) {
    const { success } = await this.db.run(`
      UPDATE nodes
      SET 
        components = ?,
        information = ? 
      WHERE node_id = ?
    `, [components, information, nodeId])
    return success
  }
  async delete ({ nodeId }) {
    const { success } = await this.db.run('DELETE FROM nodes WHERE node_id = ?', [nodeId])
    return success
  }
}