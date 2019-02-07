const EventEmitter = require('events')
const randomstring = require('randomstring')
const Db = require('./Db')

module.exports = class Instance extends EventEmitter {
  constructor (protocols, db, ddbms) {
    super()
    this.protocols = protocols
    this.db = new Db(db)
    this.ddbms = ddbms
    this.online = {
      nodes: [],
      clients: []
    }
    this.bindings = [
      {
        channel: 'node.to.instance',
        action: 'register',
        callback: this.registerNode.bind(this),
        response: {
          channel: 'instance.to.node',
          action: 'registerConfirm'
        }
      },
      {
        channel: 'node.to.instance',
        action: 'update',
        callback: this.updateNode.bind(this),
        response: {
          channel: 'instance.to.node',
          action: 'updated'
        }
      },
      {
        channel: 'node.to.instance',
        action: 'delete',
        callback: this.deleteNode.bind(this),
        response: {
          channel: 'instance.to.node',
          action: 'deleted'
        }
      },
      {
        channel: 'node.to.instance',
        action: 'login',
        callback: this.loginNode.bind(this),
        response: {
          channel: 'instance.to.node',
          action: 'logged'
        }
      },
      {
        channel: 'node.to.instance',
        action: 'ping',
        callback: this.ping.bind(this),
        response: {
          channel: 'instance.to.node',
          action: 'pinged'
        }
      }
    ]
  }
  loadListeners () {
    for (let protocolId in this.protocols) {
      let protocol = this.protocols[protocolId]
      protocol.loadListeners(this.bindings)
      protocol.disconnect(this.logoutNode.bind(this))
    }
  }
  ping (protocol, sender, parameters, reply) {
    this.emit('ping', parameters)
    reply({
      success: true
    })
  }
  async registerNode (protocol, sender, parameters, reply) {
    let token = randomstring.generate(5) + Date.now()
    const queryParameters = {
      token: token,
      components: parameters.components,
      information: JSON.stringify(parameters.information),
      resource: protocol + '://' + sender
    }
    const { success } = await this.db.run(`
      INSERT INTO nodes (
        token,
        components,
        information,
        resource,
        active
      ) VALUES
      (?, ?, ?, ?, 0)
      `, Object.values(queryParameters)
    )
    if (success) {
      const protocolRegex = parameters.components.match(/(^\w+:|^)\/\//)
      const ddbms = protocolRegex[0].replace('://', '')
      const components = parameters.components.replace(/(^\w+:|^)\/\//, '')
      await this.ddbms[ddbms].save(components).catch(e => {})
      reply({ success: true, token: token })
    } else {
      reply({ success: false })
    }
  }
  isNodeTokenValid (token) {
    return this.db.run('SELECT * FROM nodes WHERE token = ?', [token])
  }
  async updateNode (protocol, sender, parameters, reply) {
    const { success, results } = await this.isNodeTokenValid(parameters.token)
    if (success) {
      const node = results[0]
      const { success } = await this.db.run(`UPDATE nodes
        SET 
          components = ?,
          information = ? 
        WHERE node_id = ?
      `, [parameters.components, parameters.information, node.node_id])
      if (success) {
        const updatedOnlineNode = this.online.nodes.find(n => n.id === node.node_id)
        if (updatedOnlineNode) {
          updatedOnlineNode.components = parameters.components
        }
        reply({
          success: true
        })
      } else {
        reply({
          success: false
        })
      }
    }
  }
  async deleteNode (protocol, sender, parameters, reply) {
    const { success, results } = await this.isNodeTokenValid(parameters.token)
    if (success) {
      const node = results[0]
      const { success } = await this.db.run('DELETE FROM nodes WHERE node_id = ?', [node.node_id])
      if (success) {
        reply({
          success: true
        })
        this.logoutNode(protocol, sender)
      } else {
        reply({
          success: false
        })
      }
    }
  }
  async loginNode (protocol, sender, parameters, reply) {
    const { success, results } = await this.isNodeTokenValid(parameters.token)
    if (success) {
      const node = results[0]
      this.online.nodes.push({
        components: node.components,
        id: node.node_id,
        resource: sender,
        protocol: protocol
      })
      reply({
        success: true,
        components: node.components
      })
    } else {
      reply({
        success: false
      })
    }
  }
  logoutNode (protocol, sender) {
    this.online.nodes = this.online.nodes.filter(n => n.resource !== sender)
    this.emit('disconnected')
  }
}
