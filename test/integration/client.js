/* global describe before after it */
const expect = require('chai').expect
// mocha is defined globally, no need to require

const IPFS = require('ipfs')
let ipfsNode = null

// protocol dependencies
const io = require('socket.io-client')
const ioNode = require('socket.io-client')
const Httpdispatcher = require('httpdispatcher')
const dispatcher = new Httpdispatcher()

describe('Client Integration Test', function () {
  this.timeout(10000)
  let ws
  let instance
  let socket
  let socketNode
  let token = null
  const assertResponse = function (res, action) {
    expect(res, 'Response is not an object').to.be.an('object')
    expect(res, 'Response action property is invalid').to.have.property(
      'action',
      action
    )
    expect(res.parameters, 'Response parameters are invalid').to.have.property(
      'success',
      true
    )
  }

  before(function (done) {
    // setup and run local instance (for both ws and http)
    const WsProtocol = require('../../src/protocols/WebSockets')
    const HttpProtocol = require('../../src/protocols/Http')
    const Instance = require('../../src/Instance')

    // initialize database
    const sqlite3 = require('sqlite3').verbose()
    const db = new sqlite3.Database('var/instance.db', sqlite3.OPEN_READWRITE, function (err) {
      if (err) {
        console.log(err)
      }
    })

    // initialize ipfs
    ipfsNode = new IPFS({
      silent: true,
      repo: 'var/instance',
      config: {
        Addresses: {
          Swarm: ['/ip4/0.0.0.0/tcp/0']
        }
      }
    })

    const Ipfs = require('../../src/ddbms/Ipfs')
    let ddbms = {}
    const ipfsddbms = new Ipfs(ipfsNode)
    ddbms[ipfsddbms.ID] = ipfsddbms

    // initialize a websocket server
    ws = require('socket.io').listen(3334)

    // initialize the Instance with the object
    ipfsNode.on('ready', () => {
      instance = new Instance({
        'ws': new WsProtocol(ws),
        'http': new HttpProtocol(dispatcher)
      }, db, ddbms)
      // for each protocol initialize the listeners
      instance.loadListeners()
      socket = io.connect('http://localhost:3334')
      socketNode = ioNode.connect('http://localhost:3334')
      done()
    })
  })

  after(function (done) {
    if (socket.connected) {
      socket.disconnect()
    } else {
      console.log('No socket connection to break...')
    }
    if (socketNode.connected) {
      socketNode.disconnect()
    } else {
      console.log('No socketNode connection to break...')
    }
    ws.close()
    ipfsNode.stop()
    done()
  })

  it('Should register new client', function (done) {
    socket.once('instance.to.client', res => {
      token = res.parameters.token
      assertResponse(res, 'registerConfirm')
      done()
    })
    socket.emit('client.to.instance', {
      action: 'register',
      parameters: {
        information: '{ name: "test_client" }'
      }
    })
  })
  it('Should login existing client', function (done) {
    socket.once('instance.to.client', res => {
      assertResponse(res, 'logged')
      done()
    })
    socket.emit('client.to.instance', {
      action: 'login',
      authentication: {
        token: token
      }
    })
  })
  it('Should update existing client', function (done) {
    socket.once('instance.to.client', res => {
      assertResponse(res, 'updated')
      done()
    })
    socket.emit('client.to.instance', {
      action: 'update',
      parameters: {
        information: '{ name: "test_client_updated" }'
      },
      authentication: {
        token: token
      }
    })
  })
  it('Should logout existing client', function (done) {
    const lengthBeforeLogout = instance.online.clients.length
    socket.disconnect()
    const onDisconnected = () => {
      const lengthAfterLogout = instance.online.clients.length
      expect(lengthAfterLogout, 'Online clients list didn\'t change').to.be.eq(lengthBeforeLogout - 1)
      instance.removeListener('clientDisconnects', onDisconnected)
      done()
    }
    instance.on('clientDisconnects', onDisconnected)
  })
  it('Should delete existing client', function (done) {
    socket = io.connect('http://localhost:3334')
    socket.once('instance.to.client', res => {
      assertResponse(res, 'deleted')
      done()
    })
    socket.emit('client.to.instance', {
      action: 'delete',
      authentication: {
        token: token
      }
    })
  })
  it('Should forward a message from client to an online node through instance', function (done) {
    let tokenNode
    let tokenClient
    function loginNode () {
      socketNode.once('instance.to.node', res => {
        assertResponse(res, 'logged')
        // node start listening for incoming messages from client
        socketNode.once('client.to.node', function (res) {
          assertResponse(res, 'test')
          done()
        })
        // client send a forwarded message to the node using the instance as mediator
        socket.emit('client.to.node', {
          action: 'test',
          recipient: {
            recipient: res.parameters.id
          },
          parameters: {
            success: true
          },
          authentication: {
            token: tokenClient
          }
        })
      })
      socketNode.emit('node.to.instance', {
        action: 'login',
        authentication: {
          token: tokenNode
        }
      })
    }
    function registerNode () {
      socketNode.once('instance.to.node', res => {
        tokenNode = res.parameters.token
        assertResponse(res, 'registerConfirm')
        loginNode()
      })
      instance.ddbms['ipfs'].add([]).then(hash => {
        socketNode.emit('node.to.instance', {
          action: 'register',
          parameters: {
            components: 'ipfs://' + hash,
            information: '{ name: "test_node" }'
          }
        })
      })
    }
    function loginClient () {
      socket.once('instance.to.client', res => {
        assertResponse(res, 'logged')
        registerNode()
      })
      socket.emit('client.to.instance', {
        action: 'login',
        authentication: {
          token: tokenClient
        }
      })
    }
    function registerClient () {
      socket.once('instance.to.client', res => {
        tokenClient = res.parameters.token
        assertResponse(res, 'registerConfirm')
        loginClient()
      })
      socket.emit('client.to.instance', {
        action: 'register',
        parameters: {
          information: '{ name: "test_client" }'
        }
      })
    }
    registerClient()
  })
  it('Should forward a message from client to an offline node through instance, saving the message in the queue', function (done) {
    let tokenClient
    let tokenNode
    function loginNode () {
      socket.once('instance.to.node', res => {
        assertResponse(res, 'logged')
        const message = JSON.parse(res.parameters.queue[0].message)
        expect(message, 'Message not correctly saved in queue').to.have.property(
          'test',
          'test1'
        )
        done()
      })
      socket.emit('node.to.instance', {
        action: 'login',
        authentication: {
          token: tokenNode
        }
      })
    }
    function registerNode () {
      socketNode.once('instance.to.node', res => {
        assertResponse(res, 'registerConfirm')
        tokenNode = res.parameters.token
        socket.once('instance.to.client', res => {
          assertResponse(res, 'forwarded')
          loginNode()
        })
        socket.emit('client.to.node', {
          action: 'test',
          recipient: {
            recipient: res.parameters.id
          },
          parameters: {
            test: 'test1'
          },
          authentication: {
            token: tokenClient
          }
        })
      })
      instance.ddbms['ipfs'].add([]).then(hash => {
        socketNode.emit('node.to.instance', {
          action: 'register',
          parameters: {
            components: 'ipfs://' + hash,
            information: '{ name: "test_node" }'
          }
        })
      })
    }
    function loginClient () {
      socket.once('instance.to.client', res => {
        assertResponse(res, 'logged')
        registerNode()
      })
      socket.emit('client.to.instance', {
        action: 'login',
        authentication: {
          token: tokenClient
        }
      })
    }
    function registerClient () {
      socket.once('instance.to.client', res => {
        tokenClient = res.parameters.token
        assertResponse(res, 'registerConfirm')
        loginClient()
      })
      socket.emit('client.to.instance', {
        action: 'register',
        parameters: {
          information: '{ name: "test_client" }'
        }
      })
    }
    registerClient()
  })
})
