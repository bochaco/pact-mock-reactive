Interactions = new Mongo.Collection('interactions');

Meteor.startup(function () {
    // code to run on server at startup
    return;
});

Meteor.methods({
    resetInteractions: function () {
        Interactions.update({ count: { $gte: 0 } }, { $set : { count: 1 } });
        Interactions.remove({ count: { $lt: 0 } });
    },
    clearInteractions: function () {
        Interactions.remove({});
    }
});

var path = Npm.require('path'),
    appRoot = path.resolve('.');
// find better way
appRoot = appRoot.indexOf('.meteor') >= 0 ? appRoot.substring(0, appRoot.indexOf('.meteor')) : appRoot;

var fs = Npm.require('fs'),
    registerInteraction = function (req, res) {
        var selector = {
                'interaction.request.method': req.body.request.method,
                'interaction.request.path': req.body.request.path,
                'interaction.request.query': req.body.request.query,
                'interaction.request.headers': req.body.request.headers
            },
            matchingInteraction = Interactions.findOne(selector),
            consumerName = req.headers['x-pact-consumer'],
            providerName = req.headers['x-pact-provider'];

        if (matchingInteraction) {
            if (consumerName !== matchingInteraction.consumer || providerName !== matchingInteraction.provider) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('The interaction is already registered but against a different pair of consumer-provider');
            } else {
                Interactions.update({ _id: matchingInteraction._id }, { $inc: { count: 1 } });
            }
        } else {
            Interactions.insert({
                consumer: consumerName,
                provider: providerName,
                count: 1,
                disabled: false,
                interaction: req.body
            });
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Set interactions for ' + consumerName + '-' + providerName);
    },
    verifyInteractions = function (res) {
        var unexpectedReqs = Interactions.find({ count: { $lt: 0 }, disabled: false }).fetch(),
            missingReqs = Interactions.find({ count: { $gt: 0 }, disabled: false }).fetch(),
            resText;
        if (missingReqs.length === 0 && unexpectedReqs.length === 0) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Interactions matched');
        } else {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            resText = 'Actual interactions do not match expected interactions for mock MockService.\n';
            if (missingReqs.length > 0) {
                resText += '\nMissing requests:\n';
                _.each(missingReqs, function (element) {
                    resText += '\t' + element.consumer + '-' + element.provider + ': ';
                    resText += element.interaction.request.method.toUpperCase() + ' ';
                    resText += element.interaction.request.path;
                    resText += ' (' + element.count + ' missing request/s)\n';
                });
            }
            if (unexpectedReqs.length > 0) {
                resText += '\nUnexpected requests:\n';
                _.each(unexpectedReqs, function (element) {
                    resText += '\t' + element.consumer + '-' + element.provider + ': ';
                    resText += element.interaction.request.method.toUpperCase() + ' ';
                    resText += element.interaction.request.path;
                    resText += ' (' + (-1 * element.count) + ' unexpected request/s)\n';
                });
            }
            res.end(resText);
        }
    },
    writePact = function (req, res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.body.consumer && req.body.consumer.name && req.body.provider && req.body.provider.name) {
            var interactions = Interactions.find({
                    consumer: req.body.consumer.name,
                    provider: req.body.provider.name,
                    disabled: false
                }).fetch(),
                pact = req.body,
                filename = (req.body.consumer.name.toLowerCase() + '-' + req.body.provider.name.toLowerCase()).replace(/\s/g, '_'),
                path = appRoot + 'pacts/' + filename + '.json';

            pact.interactions = [];
            _.each(interactions, function (element) {
                pact.interactions.push(element.interaction);
            });

            pact.metadata = {
                'pactSpecificationVersion': '1.0.0'
            };

            fs.writeFile(path, JSON.stringify(pact), function (err) {
                if (err) {
                    res.end(JSON.stringify({ 'message': 'Error ocurred in mock service: RuntimeError - pact file couldn\'t be saved' }));
                } else {
                    res.end(JSON.stringify(pact));
                }
            });
        } else {
            res.end(JSON.stringify({ 'message': 'Error ocurred in mock service: RuntimeError - You must specify a consumer and provider name' }));
        }
    },
    requestsHandler = function (method, path, query, req, res) {
        var selector = {
                'interaction.request.method': method.toLowerCase(),
                'interaction.request.path': path,
                disabled: false
            },
            matchingInteractions = Interactions.find(selector).fetch(),
            selectedInteraction,
            err = {
                'message': 'No interaction found for ' + method + ' ' + path + ' ' + JSON.stringify(query),
                'interaction_diffs': []
            },
            matchingHeaders,
            expectedResponse;

        _.each(matchingInteractions, function(matchingInteraction) {
  
            // compare headers of actual and expected
            matchingHeaders = matchingInteraction.interaction.request.headers;
            // iterate thru expected headers to make sure it's in the actual header
            _.each(matchingHeaders, function (value, key) {
                var actualHdr = req.headers[String(key).toLowerCase()];
                if (!actualHdr || actualHdr !== value) {
                    err.interaction_diffs.push({
                        'headers': {
                            'expected': { key: key, value: value },
                            'actual': { key: key, value: actualHdr }
                        }
                    });
                }
            });

            // compare query of actual and expected
            if (!_.isEqual(matchingInteraction.interaction.request.query, req.query)) {
                err.interaction_diffs.push({
                    'query': {
                        'expected': matchingInteraction.interaction.request.query,
                        'actual': req.query
                    }
                });
            }

            // compare body of actual and expected
            if (!_.isEqual(matchingInteraction.interaction.request.body, req.body)) {
                err.interaction_diffs.push({
                    'body': {
                        'expected': matchingInteraction.interaction.request.body,
                        'actual': req.body
                    }
                });
            }
            if (err.interaction_diffs.length === 0) {
                selectedInteraction = matchingInteraction;
            }
        });

        if (selectedInteraction) {
            Interactions.update({ _id: selectedInteraction._id }, { $inc: { count: -1 } });
            expectedResponse = selectedInteraction.interaction.response;
            res.writeHead(expectedResponse.status, expectedResponse.headers);
            res.end(JSON.stringify(expectedResponse.body));
        } else {
            // this is an unexpected interaction
            Interactions.insert({
                consumer: 'UNEXPECTED',
                provider: 'UNEXPECTED',
                count: -1,
                interaction: {
                    request: {
                        method: method.toLowerCase(),
                        path: path,
                        query: query,
                        headers: req.headers,
                        body: req.body
                    },
                    reponse: {}
                }
            });
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(err));
        }
    },
    routeInteractions = function (route) {
        var headers = route.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
            registerInteraction(route.request, route.response);
        } else {
            requestsHandler(route.method, route.url, route.params.query, route.request, route.response);
        }
    },
    routePact = function (route) {
        var headers = route.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
            writePact(route.request, route.response);
        } else {
            requestsHandler(route.method, route.url, route.params.query, route.request, route.response);
        }
    };

Router.route('/interactions', { where: 'server' })
    .post(function () {
        routeInteractions(this);
    })
        .put(function () {
        routeInteractions(this);
    })
    .delete(function () {
        var headers = this.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
            Interactions.remove({});
            this.response.writeHead(200, { 'Content-Type': 'text/plain' });
            this.response.end('Deleted interactions');
        } else {
            requestsHandler(this.method, this.url, this.params.query, this.request, this.response);
        }
    });

Router.route('/interactions/verification', { where: 'server' })
    .get(function () {
        var headers = this.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
            verifyInteractions(this.response);
        } else {
            requestsHandler(this.method, this.url, this.params.query, this.request, this.response);
        }
    });

Router.route('/pact', { where: 'server' })
    .post(function () {
        routePact(this);
    })
        .put(function () {
        routePact(this);
    });

Router.route('(.+)', function () {
    if (this.url === '/favicon.ico') {
        this.response.writeHead(200, { 'Content-Type': 'application/json' });
        this.response.end();
    } else {
        requestsHandler(this.method, '/' + this.params, this.params.query, this.request, this.response);
    }
}, { where: 'server' });
