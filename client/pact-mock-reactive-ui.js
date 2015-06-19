var escapeMetaCharacters = function (string) {
    return string.replace(/\$/g, '\\uff04').replace(/\./g, '\\uff0E');
},
    unescapeMetaCharacters = function (string) {
        return string.replace(/\uff04/g, '$').replace(/\uff0E/g, '.');
    },
    Interactions = new Mongo.Collection('interactions', {
        transform: function (doc) {
            //workaround for dots in the keys (problem with mongo)
            doc.interaction = JSON.parse(unescapeMetaCharacters(JSON.stringify(doc.interaction)));
            return doc;
        }
    }),
    syntaxHighlight = function (json) {
        json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            var cls = 'blue';
            //The next code is available if we want to change the color according to the value type
            /*if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'key';
                } else {
                    cls = 'string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'boolean';
            } else if (/null/.test(match)) {
                cls = 'null';
            }*/
            return '<span class="' + cls + '">' + match + '</span>';
        });
    };

Router.route('/', function () {
    return;
});

Meteor.startup(function () {
    // code to run on client at startup
    Session.setDefault({
        'description': "",
        'consumer': "",
        'provider': "",
        'provider_state': "",
        'method': "",
        'path': "",
        'query': "",
        'reqHeaderObj': "",
        'reqObj': "",
        'resStatus': "",
        'resHeaderObj': "",
        'resObj': ""
    });

    $('.ui.accordion').accordion({ exclusive: false });

    $('.ui.pacts.modal')
        .modal('setting', 'transition', 'fade down')
        .modal('setting', 'can fit', 'true');

    $('.ui.add.modal')
        .modal({
            closable  : false,
            onDeny    : function () {
                return false;
            },
            onApprove : function () {
                var interaction = {
                    provider_state: Session.get('provider_state'),
                    description: Session.get('description'),
                    request: {
                        method: Session.get('method').toLowerCase(),
                        path: Session.get('path'),
                        query: JSON.parse(Session.get('query')),
                        headers: JSON.parse(Session.get('reqHeaderObj')),
                        body: JSON.parse(Session.get('reqObj'))
                    },
                    response: {
                        status: Session.get('resStatus'),
                        headers: JSON.parse(Session.get('resHeaderObj')),
                        body: JSON.parse(Session.get('resObj'))
                    }
                };
                Meteor.call("addInteraction", Session.get('consumer'), Session.get('provider'), interaction);
            }
        });
});

Template.body.helpers({
    interactions: function () {
        return Interactions.find();
    },
    interactionsHelper: function () {
        return JSON.stringify(Interactions.find().fetch());
    }
});

Template.body.events({
    'click #resetbutton': function () {
        Meteor.call("resetInteractions");
    },
    'click #clearbutton': function () {
        Meteor.call("clearInteractions");
    },
    'click #pactsbutton': function () {
        $('.ui.pacts.modal').modal('show');
    },
    'click #addbutton': function () {
        $('.ui.add.modal').modal('show');
    }
});

Template.interaction.helpers({
    receivedHelper: function () {
        return this.count === 0;
    },
    countHelper: function () {
        var label = "Received";
        if (this.count > 0) {
            label = "Missing";
            if (this.count > 1) {
                label += " (" + this.count + ")";
            }
        } else if (this.count < 0) {
            label = "Unexpected";
            if (this.count < -1) {
                label += " (" + (-1 * this.count) + ")";
            }
        }
        return label;
    },
    disabledHelper: function () {
        return this.disabled;
    },
    queryHelper: function (object) {
        var str = $.param(object);
        return str ? "?" + decodeURIComponent(str) : str;
    },
    jsonHelper: function (object) {
        return syntaxHighlight(JSON.stringify(object || {}, null, 4));
    }
});

Template.interaction.events({
    'click #removeInteraction': function () {
        Interactions.remove(this._id);
    },
    'click #toggleInteraction': function () {
        Interactions.update({ _id: this._id }, { $set: { disabled: !this.disabled } });
    }
});

Template.showPacts.helpers({
    pacts: function () {
        var str = "",
            pact = {},
            interactions = Interactions.find({
                disabled: false
            }).fetch(),
            groupedInteractions = _.groupBy(interactions, function (element) {
                return element.consumer + element.provider;
            }),
            pairs = [];

        _.each(groupedInteractions, function (value) {
            str += "<span class='black'><b>Pact between " + value[0].consumer + " and " + value[0].provider + ":</b></span><br/>";
            pact = {
                consumer: {
                    name: value[0].consumer
                },
                provider: {
                    name: value[0].provider
                }
            };
            pairs.push(pact);
            pact.interactions = [];
            _.each(value, function (element) {
                pact.interactions.push(element.interaction);
            });

            str += '<pre class="black">' + syntaxHighlight(JSON.stringify(pact, null, 4)) + "</pre><br/><br/>";
        });

        Session.set("pairsConsumerProvider", pairs);
        return str ? str.substring(0, str.length - 10) : str;
    }
});

Template.addInteraction.helpers({
    description: function () {
        return Session.get('description');
    },
    consumer: function () {
        return Session.get('consumer');
    },
    provider: function () {
        return Session.get('provider');
    },
    provider_state: function () {
        return Session.get('provider_state');
    },
    method: function () {
        return Session.get('method');
    },
    path: function () {
        return Session.get('path');
    },
    query: function () {
        return Session.get('query');
    },
    reqHeaderObj: function () {
        return Session.get('reqHeaderObj');
    },
    reqObj: function () {
        return Session.get('reqObj');
    },
    resStatus: function () {
        return Session.get('resStatus');
    },
    resHeaderObj: function () {
        return Session.get('resHeaderObj');
    },
    resObj: function () {
        return Session.get('resObj');
    },
    verbs: function () {
        var verbs = [
            { name: "GET" },
            { name: "POST" },
            { name: "PUT" },
            { name: "DELETE" },
            { name: "PATCH" }
        ];
        return verbs;
    }
});

Template.addInteraction.events({
    'change input': function (event) {
        Session.set(event.target.id, event.target.value);
    },
    'change #method': function (event) {
        Session.set(event.target.id, event.target.value);
    }
});