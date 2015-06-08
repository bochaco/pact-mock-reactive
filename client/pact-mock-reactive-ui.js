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
    objTree = function (obj, level) {
      var str = "",
          tabs = Array(3*level).join("&nbsp;");

      _.each (obj, function (value, key) {
        if (typeof value === 'undefined' || value === null) {
          str += tabs + "\"" + key + "\"<span class='black'> : null</span><br/>";
        } else if (Array.isArray(value)) {
          str += tabs + "\"" + key + "\"<span class='black'> : [</span><br/>";
          for (i in value) {
            str += tabs + tabs + "<span class='black'>{</span><br/>";
            str += objTree(value[i], 2 + level);
            str += tabs + tabs + "<span class='black'>}</span><br/>";
          }
          str += tabs + "<span class='black'>]</span><br/>";
        } else if (typeof value === 'object') {
          str += tabs + "\"" + key + "\"<span class='black'> : {</span><br/>";
          str += objTree(value, 1 + level);
          str += tabs + "<span class='black'>}</span><br/>";
        } else {
          str += tabs + "\"" + key + "\"<span class='black'> : </span>\"" + value + "\"<br/>";
        }
      });

      return str;
    };

Router.route('/', function () {});

Meteor.startup(function () {
  // code to run on client at startup
  $('.ui.accordion').accordion({exclusive: false});

  $('.ui.pacts.modal')
    .modal('setting', 'transition', 'fade down')
    .modal('setting', 'can fit', 'true');

  $('.ui.add.modal')
    .modal({
      closable  : false,
      onDeny    : function(){
        return false;
      },
      onApprove : function() {
        var interaction = {
          provider_state: Session.get('provider_state'),
          providerState : null,
          description: Session.get('comment'),
          request: {
            method: Session.get('method').toLowerCase(),
            path: Session.get('path'),
            query: Session.get('query'),
            headers: Session.get('reqHeaderObj'),
            body: Session.get('reqObj')
          },
          response: {
            status: Session.get('resStatus'),
            headers: Session.get('resHeaderObj'),
            body: Session.get('resObj')
          }
        }

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
  },
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
    var str = "";
    _.each(object, function(value, key) {
      if (str.length) {
        str += "&";
      } else {
        str += "/";
      }
      str += key + "=" + value;
    });

    return str;
  },
  jsonHelper: function (object, str) {
    if (object) {
      str = "<span class='black'>{</span><br/>";
      str += objTree(object, 1);
      str += "<span class='black'>}</span>";
    }
    return str;
  }
});

Template.interaction.events({
  'click #removeInteraction': function () {
    Interactions.remove(this._id);
  },
  'click #toggleInteraction': function () {
    Interactions.update({_id: this._id}, {$set: {disabled: !this.disabled} });
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

    _.each(groupedInteractions, function (value, key) {
      str += "<span class='black'>Pact between " + value[0].consumer + " and " + value[0].provider + ":</span><br/>";
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
      pact.metadata = {
        pactSpecificationVersion: '1.0.0'
      }

      str += "<span class='black'>{</span><br/>";
      str += objTree(pact, 1);
      str += "<span class='black'>}</span><br/><br/>";
    });

    Session.set("pairsConsumerProvider", pairs);

    return str;
  }
});

Template.addInteraction.helpers({
  comment: function () {
    return Session.get('comment');
  },
  consumer: function () {
    return Session.get('consumer');
  },
  provider: function () {
    return Session.get('provider');
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
    return verbs;
  }
});

