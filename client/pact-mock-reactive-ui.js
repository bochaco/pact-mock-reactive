Interactions = new Mongo.Collection("interactions");

Router.route('/', function () {});

Meteor.startup(function () {
  // code to run on client at startup
  $('.ui.accordion').accordion({exclusive: false});
  $('.ui.long.modal')
      .modal('setting', 'transition', 'fade down')
      .modal('setting', 'can fit', 'true');
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
    $('.ui.modal').modal('show');
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
  jsonHelper: function (object, str) {
    if (object) {
      str = JSON.stringify(object);
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

