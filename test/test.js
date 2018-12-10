/* global describe before after it */
const expect = require('chai').expect
// mocha is defined globally, no need to require

// protocol dependencies
const io = require('socket.io-client')
const Httpdispatcher = require('httpdispatcher')
const dispatcher = new Httpdispatcher()
function handleRequest (request, response) {
  try {
    dispatcher.dispatch(request, response)
  } catch (err) {
    console.log(err)
  }
}

describe('Local instance test suite', function () {
  // increase test timeout to 10 seconds
  this.timeout(10000)
  let ws
  let http
  let instance
  before(function (done) {
    // setup and run local instance (for both ws and http)
    const WsProtocol = require('../src/protocols/WebSockets')
    const HttpProtocol = require('../src/protocols/Http')
    const Instance = require('../src/Instance')

    // initialize a websocket server
    ws = require('socket.io').listen(3334)

    // initialize an http server
    http = require('http').createServer(handleRequest)

    // create an object containing the protocols specifications
    let protocols = {}
    let wspro = new WsProtocol(ws)
    let httppro = new HttpProtocol(http)
    protocols[wspro.ID] = wspro
    protocols[httppro.ID] = httppro

    // initialize the Instance with the object
    instance = new Instance(protocols)

    // for each protocol initialize the listeners
    ws.on('connection', socket => {
      instance.loadListeners(wspro.ID, socket)
    })
    instance.loadListeners(httppro.ID, dispatcher)
    done()
  })

  after(function (done) {
    // kill local instance (ws server and http server)
    ws.close()
    http.close()
    done()
  })

  describe("Testing instance's protocols", function () {
    let socket
    let httpNode
    const assertResponse = function (res, action, parameters) {
      expect(res, 'Response is not an object').to.be.an('object')
      expect(res, 'Response action property is invalid').to.have.property(
        'action',
        action
      )
      expect(res, 'Response parameters are invalid').to.have.deep.property(
        'parameters',
        parameters
      )
    }

    before(function (done) {
      socket = io.connect('http://localhost:3334')
      httpNode = require('http').createServer(handleRequest)
      httpNode.listen(8888)
      done()
    })

    after(function (done) {
      if (socket.connected) {
        socket.disconnect()
      } else {
        console.log('No socket connection to break...')
      }
      httpNode.close()
      done()
    })

    describe('Testing WebSocket protocol', function () {
      it('Should send messages to all sockets', function (done) {
        instance.protocols['ws'].to(null, 'instance.to.test', 'test', {
          success: true
        })
        socket.once('instance.to.test', res => {
          assertResponse(res, 'test', { success: true })
          done()
        })
      })
      it('Should listen to a socket', function (done) {
        socket.emit('node.to.instance', {
          action: 'register',
          parameters: {
            success: true
          }
        })
        instance.on('nodeRegister', res => {
          expect(res).to.have.property('success', true)
          done()
        })
      })
    })

    describe('Testing HTTP protocol', function () {
      it('Should send and reply to a message', function (done) {
        instance.protocols['http'].to('http://localhost:8888/', 'instance.to.test', 'test', { success: true }, {
          channel: 'test.to.instance',
          action: 'testReceived',
          callback: (protocol, sender, parameters) => {
            assertResponse(parameters, 'testReceived', { success: true })
            done()
          }
        })
        dispatcher.onPost('/instance.to.test/test', (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          const parameters = JSON.parse(req.body)
          assertResponse(parameters, 'test', { success: true })
          res.end(JSON.stringify({
            channel: 'test.to.instance',
            action: 'testReceived',
            parameters: { success: true }
          }))
        })
      })
    })
  })
})
