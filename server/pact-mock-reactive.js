Interactions = new Mongo.Collection("interactions");

Meteor.startup(function () {
  // code to run on server at startup
});

Meteor.methods({
  resetInteractions: function () {
    Interactions.update({count: {$gte: 0}}, {$set : {count: 1}});
    Interactions.remove({count: {$lt: 0}});
  },
  clearInteractions: function () {
    Interactions.remove({});
  }    
});

var registerInteraction = function (req, res) {
    var selector = {
        'interaction.request.method': req.body.request.method, 
        'interaction.request.path': req.body.request.path,
        'interaction.request.query': req.body.request.query,
        'interaction.request.headers': req.body.request.headers
    }
    var matchingInteraction = Interactions.findOne(selector);
    
    var consumerName = req.headers["x-pact-consumer"];
    var providerName = req.headers["x-pact-provider"];
    if (matchingInteraction) {
        if (consumerName != matchingInteraction.consumer || providerName != matchingInteraction.provider) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end("The interaction is already registered but against a different pair of consumer-provider");
        } else {
            Interactions.update({ _id: matchingInteraction._id }, { $inc: { count: 1 } });
        }
    } else {
        var newInteraction = {
            consumer: consumerName,
            provider: providerName,
            count: 1,
            disabled: false,
            interaction: req.body
        };
        Interactions.insert(newInteraction);
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Set interactions for " + consumerName + '-' + providerName);
},
    verifyInteractions = function (res) {
        var unexpectedReqs = Interactions.find({ count: { $lt: 0 }, disabled: false }).fetch();
        var missingReqs = Interactions.find({ count: { $gt: 0 }, disabled: false }).fetch();
        if (missingReqs.length === 0 && unexpectedReqs.length === 0) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end("Interactions matched");
        } else {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            var resText = "Actual interactions do not match expected interactions for mock MockService.\n";
            if (missingReqs.length > 0) {
                resText += "\nMissing requests:\n";
                for (var index in missingReqs) {
                    resText += "\t" + missingReqs[index].consumer + "-" + missingReqs[index].provider + ": ";
                    resText += missingReqs[index].interaction.request.method.toUpperCase() + " ";
                    resText += missingReqs[index].interaction.request.path;
                    resText += " (" + missingReqs[index].count + " missing request/s)\n";
                }
            }
            if (unexpectedReqs.length > 0) {
                resText += "\nUnexpected requests:\n";
                for (var index in unexpectedReqs) {
                    resText += "\t" + unexpectedReqs[index].consumer + "-" + unexpectedReqs[index].provider + ": ";
                    resText += unexpectedReqs[index].interaction.request.method.toUpperCase() + " ";
                    resText += unexpectedReqs[index].interaction.request.path;
                    resText += " (" + (-1 * unexpectedReqs[index].count) + " unexpected request/s)\n";
                }
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
            }).fetch();
            
            var pact = req.body;
            pact.interactions = [];
            for (var index in interactions) {
                pact.interactions.push(interactions[index].interaction);
            }
            
            pact.metadata = {
                "pactSpecificationVersion": "1.0.0"
            }
            
            var filename = (req.body.consumer.name.toLowerCase() + '-' + req.body.provider.name.toLowerCase()).replace(/\s/g, "_");
            var path = process.env.PWD + "/pacts/" + filename + ".json";
            fs = Npm.require('fs');
            fs.writeFile(path, JSON.stringify(pact), function (err) {
                if (err) {
                    res.end(JSON.stringify({ "message": "Error ocurred in mock service: RuntimeError - pact file couldn't be saved" }));
                } else {
                    res.end(JSON.stringify(pact));
                }
            });
        } else {
            res.end(JSON.stringify({ "message": "Error ocurred in mock service: RuntimeError - You must specify a consumer and provider name" }));
        }
    },
    isObjContained = function (obj1, obj2, twoway) {
        var result = true;
        for (var prop in obj1) {
            if (typeof obj2[prop] == 'undefined') {
                return false;
            }
            
            if (typeof obj2[prop] == 'object') {
                if (!isObjContained(prop, obj2[prop])) {
                    return false;
                }
            }
            
            if (obj1[prop] != obj2[prop]) {
                return false;
            }
        }
        if (twoway) {
            result = isObjContained(obj2, obj1, false);
        }
        return result;
    },
    requestsHandler = function (method, path, query, req, res) {
        var selector = {
            'interaction.request.method': method.toLowerCase(), 
            'interaction.request.path': path,
            disabled: false
        }
        var matchingInteractions = Interactions.find(selector).fetch();
        var done = false;
        var err = {
            "message": "No interaction found for " + method + " " + path + " " + JSON.stringify(query),
            "interaction_diffs": []
        }
        
        if (matchingInteractions.length > 1) { // this shouldn't occur
            err.message = "Multiple interaction found for " + method + " " + path;
            for (var index in matchingInteractions) {
                err.interaction_diffs.push({
                    description: matchingInteractions[index].interaction.description,
                    request: matchingInteractions[index].interaction.request
                });
            }
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(err));
            done = true;
        }
        else if (matchingInteractions.length === 1) {
            // compare headers of actual and expected
            var matchingHeaders = matchingInteractions[0].interaction.request.headers;
            for (var key in matchingHeaders) { // iterate thru expected headers to make sure it's in the actual header
                var actualHdr = req.headers[String(key).toLowerCase()];
                if (!actualHdr || actualHdr !== matchingHeaders[key]) {
                    err.interaction_diffs.push({
                        "headers": {
                            "expected": { key: key, value: matchingHeaders[key] },
                            "actual": { key: key, value: actualHdr }
                        }
                    });
                }
            }
            
            // compare query of actual and expected
            if (false == isObjContained(matchingInteractions[0].interaction.request.query, req.query, true)) {
                err.interaction_diffs.push({
                    "query": {
                        "expected": matchingInteractions[0].interaction.request.query,
                        "actual": req.query
                    }
                });
            }
            
            /** TODO verification of body is missing  **/
            
            if (err.interaction_diffs.length === 0) {
                Interactions.update({ _id: matchingInteractions[0]._id }, { $inc: { count: -1 } });
                var expectedResponse = matchingInteractions[0].interaction.response;
                res.writeHead(expectedResponse.status, expectedResponse.headers);
                res.end(JSON.stringify(expectedResponse.body));
                done = true;
            }
        }
        
        if (!done) {   // this is an unexpected interaction
            var newInteraction = {
                consumer: "UNEXPECTED",
                provider: "UNEXPECTED",
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
            };
            Interactions.insert(newInteraction);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(err));
        }
    },
    routeInteractions = function (route) {
        var headers = route.request.headers;
        if (headers["x-pact-mock-service"] === "true") {
            registerInteraction(route.request, route.response);
        } else {
            requestsHandler(route.method, route.url, route.params.query, route.request, route.response);
        } 
    },
	routePact = function (route) {
        var headers = route.request.headers;
        if (headers["x-pact-mock-service"] === "true") {
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
        if (headers["x-pact-mock-service"] === "true") {
            Interactions.remove({});
            this.response.writeHead(200, {'Content-Type': 'text/plain'});
            this.response.end("Deleted interactions");
        } else {
            requestsHandler(this.method, this.url, this.params.query, this.request, this.response);
        }
    });

Router.route('/interactions/verification', { where: 'server' })
    .get(function () {
        var headers = this.request.headers;
        if (headers["x-pact-mock-service"] === "true") {
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
	if(this.url === '/favicon.ico') {
		this.response.writeHead(200, {'Content-Type': 'application/json'})
		this.response.end();
	} else {
		requestsHandler(this.method, "/" + this.params, this.params.query, this.request, this.response);
	}
}, { where: 'server'});
