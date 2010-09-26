/**
* GeometryControls Class v0.2
* Copyright (c) 2008, Google 
* Author: Chris Marx and Pamela Fox and others
* 
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
* 
*       http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*
* This class lets you add a control to the map which mimics the MyMaps controls
* and allows for adding markers, polylines and polygons to the map and for uploading.
*/

/**
 * Global wrapper function for getElementsById()
 * @param {String} id Element's id
 */
function get$(id) {
  return document.getElementById(id);
  //TODO implement an element cache?
};

/**
 * Creates the parent class for Geometry Controls
 * @constructor
 * @param {Object} opt_opts Named optional arguments:
 *   @param {Object} opt_opts.controlPositionFloat A GControlAnchor for positioning the parent control container (if used)
 *   @param {Object} opt_opts.controlPosition An array with pixel values for parent control position
 *   @param {String} opt_opts.buttonWidth Button width in pixels
 *   @param {String} opt_opts.buttonHeight Button height in pixels
 *   @param {String} opt_opts.buttonBorder Button border in pixels
 *   @param {String} opt_opts.infoWindowHtmlURL The url if the html template file, containing configurable html and json for control infowindows and options
 *   @param {Object} opt_opts.stylesheets An array of urls of stylesheets to be appended 
 *   @param {Boolean} opt_opts.autoSave Determines whether the autoSave feature (via AOP) is turned on or off
 *   @param {String} opt_opts.cssId The base name for css styles
 *   @param {Boolean} opt_opts.debug Sets debug statements to GLog or turns them off for production
 */
function GeometryControls(opt_opts){
  var me = this;
  
  //self documenting object with default settings shared by geometry controls
  me.Options = {
    controlPostitionFloat:G_ANCHOR_TOP_RIGHT, 
    controlPosition:[0,0],
    buttonWidth:'33',
    buttonHeight:'33',
    buttonBorder:'0',
    buttonCursor:'pointer',
    autoSave:true, //TODO have option to turn on autoSave for individual controls?
    cssId:"emmc-geom", //for generic components shared between multiple controls 
    debug:true   
  };
  
  //overide the default Options
  if(opt_opts){
  	for (var o in opt_opts) {
  		me.Options[o] = opt_opts[o];
  	}
  } else {
  	//me.debug("??");
  }
  
  me.isIE = navigator.appName.indexOf('Explorer') > -1;
  me.isChrome = navigator.userAgent.toLowerCase().indexOf('chrome') > -1; 
  me.map = null;
  me.container = null;
  me.controls = {};
  me.buttons_ = {};
  me.stopDigitizingFuncs_ = {};
  me.bounds = new GLatLngBounds(); //for setting bounds when loading data
  me.autoSaveListener = null;  //external handle for aop
  
  //run functions that need to be initialized at startup
  me.runInitFunctions_();
};

/**
 * Inherits from GControl, makes it convenient to use map.addControl()
 */
GeometryControls.prototype = new GControl();

/**
 * Run functions that need to load content when class is instantiated
 */
GeometryControls.prototype.runInitFunctions_ = function(){
  var me = this;
  if(me.Options.autoSave){
    me.addAutoSaveAspect();
  };
};

/**
 * Required by GMaps API for controls.
 * @param {Object} opt_opts  
 *   @param {Object} opt_opts.controlPositionFloat Constant for float position
 *   @param {Object} opt_opts.controlPosition An array with top/left offset for control
 * @return {GControlPosition} Default location for control
 */
GeometryControls.prototype.getDefaultPosition = function(opt_opts) {
  var me = this, opt = me.Options, ctrlPosition;
  if (opt_opts) {
    ctrlPosition = new GControlPosition(opt_opts.controlPositionFloat,new GSize(opt_opts.controlPosition[0],opt_opts.controlPosition[1]));
  } else {
    ctrlPosition = new GControlPosition(opt.controlPositionFloat, new GSize(opt.controlPosition[0],opt.controlPosition[1]));
  }
  return ctrlPosition;
};

/**
 * Is called by GMap2's addOverlay method. Creates the button and appends to the map div.
 * Since this is called after being added to map, we can access #addControl to add geometry controls and 
 * make them available here. 
 * @param {GMap2} map The map that has had this ExtMapTypeControl added to it.
 * @return {DOM Object} Div that holds the control
 */ 
GeometryControls.prototype.initialize = function(map){
  var me = this;
  me.map = map;
  
  //could be used to group all controls. currently controls are set to position themselves in their own containers
  me.container = document.createElement("div"); 
  map.getContainer().appendChild(me.container);
  
  //initialize the controls added with #addControl
  for(var name in me.controls){
    map.addControl(me.controls[name]);
  }
  
  //initialize the maps's infowindow (it appears it takes longer the first time it is created, so avoid this timing issue)
  map.getInfoWindow();
  
  return me.container;
};

/**
 * Creates a button, and attaches listeners
 * @param {Object} required_opts All parameters are required!!
 *   @param {String} required_opts.controlName Name of control
 *   @param {Object} required_opts.button_opts 
 *     @param {String} button_opts.img_up_url Url of up image
 *     @param {String} button_opts.img_down_url Url of down image
 *     @param {String} button_opts.tooltip Text of tooltip
 *   @param {Function} required_opts.startDigitizing Function for turning on this digitizer control
 *   @param {Function} required_opts.stopDigitizing Function for turnong off this digitizer control
 */
GeometryControls.prototype.createButton = function(required_opts){
  var me = this, opts = required_opts, Options = me.Options;
  
  //make sure a digitizing function is present
  if(typeof(opts.startDigitizing) && typeof(opts.stopDigitizing) !== "function"){
    me.debug("Digitizing functions for #createButton are required");
    return;
  }
  
  var button = {};
  button.opts = opts.button_opts;  
  var button_img = document.createElement('img');
  button_img.style.cursor = button.opts.buttonCursor || Options.buttonCursor;
  button_img.width = button.opts.buttonWidth || Options.buttonWidth;
  button_img.height = button.opts.buttonHeight || Options.buttonHeight;
  button_img.border = button.opts.buttonBorder || Options.buttonBorder;
  button_img.src = button.opts.img_up_url;
  button_img.title = button.opts.tooltip;
    
  button.img = button_img;
 
  //Button toggle. First click turns it on (and other buttons off), triggers bound events. Second click turns it off
  GEvent.addDomListener(button.img, "click", function() { 
    if(button.img.getAttribute("src") === button.opts.img_up_url){
      me.toggleButtons(opts.controlName);
      opts.startDigitizing();
    } else {
      me.toggleButtons(opts.controlName);
      opts.stopDigitizing();
    }    
  });  

  me.buttons_[opts.controlName] = button;
  me.stopDigitizingFuncs_[opts.controlName] = opts.stopDigitizing;
  return button;
};

/**
 * Turns on selected digitizer button, turns off the other buttons
 * At the moment, name reference is passed rather than object, is this necessary?
 * @param {String} button_name
 */
GeometryControls.prototype.toggleButtons = function(button_name){
  var me = this;
  
  //Calls with no name will turn everything off. Calls with a name will turn all off except the named button
  for (var button in me.buttons_) {
      me.buttons_[button].img.src = me.buttons_[button].opts.img_up_url;
  }  
  if(button_name){
      me.buttons_[button_name].img.src = me.buttons_[button_name].opts.img_down_url;  
  }
  
  //turn off other digitizing listeners. Note: to avoid recursion, external calls to this function should always be made
  //without parameters!!!
  if (button_name) {
    for (var func in me.stopDigitizingFuncs_) {
      if (func != button_name) {
        me.stopDigitizingFuncs_[func](false);
      }
    }
  }
};

/**
 * Adds a geometry control to this.controls, which are then added to the map
 * Note: Would like to use the constructor name of control, so that name is not hard-coded
 * but inheriting from GControl overrides the original constructor name :(
 * @param {Object} control
 * @see #initialize
 */
GeometryControls.prototype.addControl = function(control){
  var me = this;
  
  //thanks Ates Goral
  //inheriting from GControl overrides original constructor so we use a final variable from the control(name)
  /*var controlName = function getObjectClass(obj) {  
    if (obj && obj.constructor && obj.constructor.toString) {  
      var arr = obj.constructor.toString().match(/function\s*(\w+)/);    
      if (arr && arr.length == 2) {  
           return arr[1];  
       }  
    }   
    me.debug("Can't find constructor name of control");
    return null;  
  }(control);*/ 
  
  control.zuper = me;
  me.controls[control.name] = control;
  
  //TODO turn on auto-save?
};


/**
 * Set map center and zoom to a GBounds
 * @param {Object} record - see #createGeometry_
 */
GeometryControls.prototype.zoomToBounds = function(record){
  var me = this, bounds = me.bounds;
  
  if  (!bounds.isEmpty()) {
    me.map.setCenter(bounds.getCenter());
    me.map.setZoom(me.map.getBoundsZoomLevel(bounds));
  }
};

/**
 * Delegate object creation to appropriate geometry control
 * TODO - If all controls come in with a standardized property (point,line,poly,etc), 
 * then you could replace the switch with a simple lookup, and a generic call to a loading method
 * @param {Object} record
 *   @param {String} type The type of geometry
 *   @param {Object} coordinates An array of objects {lat,lng}
 *   @param {String} title The text used for geometry infowindow title
 *   @param {String} description The text used for geometry infowindow description
 *   @param {Object} style The full style definition for the geometry
 */
GeometryControls.prototype.createGeometry_ = function(record){
  var me = this;
  
  try {
    switch (record.type) {
      case "point":
        return me.controls["markerControl"].loadMarkers(record);
      case "line":
        return me.controls["polylineControl"].loadPolylines(record);
      case "poly":
        return me.controls["polygonControl"].loadPolygons(record);
    }
  } 
  catch (e) {
    me.debug("A geometry Control has not been added for the geometry type you are trying to load or there is an error." +
             "Your error is: " + e + " at line " + e.lineNumber + " in file " + e.fileName);
  }
};

/**
 * Add aspects that listen for "Ok" button clicks, triggering an upload to the db
 * TODO - need explicit extra variable (autoSaveListener) for passing references?
 */
GeometryControls.prototype.addAutoSaveAspect = function(){
  var me = this;
  
  me.aop.addBefore(me, 'bindInfoWindow', function(args){
    var geomInfo = args[0];
    //expose the function by passing reference to autoSaveListener variable
    me.autoSaveListener = geomInfo.commitStyling;
    geomInfo.commitStyling = function(){
      me.autoSaveListener();
    };
    //attach the listener
    me.aop.addAfter(me, 'autoSaveListener', function(){
        me.saveData({
          allData:false,
          geomInfo:geomInfo
        });

    }); 
    return args;
  });
};

/**
 * Post data for storage to a db. Options to send all information or just one object?
 * @see #addAutoSaveAspect
 * @param {Object} opts
 *   @param {Object} geomInfo - @see #bindInfoWindow
 */
GeometryControls.prototype.saveData = function(opts){
  var me = this;

	//construct a json data record
	var geomInfo = opts.geomInfo, index = opts.geomInfo.index;
	var record = geomInfo.storage[index];  
	var recordJSON = {};
	recordJSON.type = record.type;
	recordJSON.geometry = {
		"type": "Polygon",
		"coordinates": []
	};
	//determine geometry type, and copy geometry appropriately
	var vertex;
	for(var i=0;i<record.geometry.getVertexCount();i++){
		vertex = record.geometry.getVertex(i);
		recordJSON.geometry.coordinates.push([vertex.lng(),vertex.lat()]);
	}

  console.log(record.id);

  // stringify the geometry
  recordJSON.geometry = JSON.stringify(recordJSON.geometry);
	//add title
	recordJSON.name = record.title[0];
  if(typeof(record.id) == "undefined") {
    $.post('/areas', {area: recordJSON});
  } else {
    $.post('/areas/' + record.id, {area: recordJSON, _method: 'PUT'});
  }
};

/**
 * Loops through all stored geometries by accessing variable for storage
 * In all of the the controls that have been added.
 * @see #addControl
 */
GeometryControls.prototype.saveAllData = function(){
  var me = this;
  //TODO
  //call save data with each geometry?
};

//================================================================= Utility Methods ========================================================//

/**
 * Javascript Beans (Value Objects)
 * @static
 */
GeometryControls.prototype.beans = {
  /**
   * Geometry Class
   * Titles/descriptions are stored as [][0,1] with 0,1 entries representing current(0)/previous(1) values
   * TODO change title/desc storage to use hash, rather than array
   * @param {Object} p 
   */
  Geometry:function(p){
    this.type = p.type;
    this.geometry = p.geometry;
    this.title = p.title || ["",""];
    this.start = p.start || ["",""];
    this.end = p.end || ["",""];
  },
  /**
   * Style Class
   * @param {Object} p
   */
  Style:function(p){
    //TODO
  }
};

/**
 * Utility function for executing functions not in global scope
 * @param {Object} milliseconds
 * @param {Object} func
 */
GeometryControls.prototype.setLocalTimeout = function(func,milliseconds){
  function delayedFunction(){
    func();
  }
  setTimeout(delayedFunction, milliseconds);
};

/**
 * Utility function for getting the absolute position of an element
 * @param {DOM Object} el The element of which to get the position
 * @see http://www.faqts.com/knowledge_base/view.phtml/aid/9095
 */
GeometryControls.prototype.getAbsolutePosition = function(el){
	for (var lx=0,ly=0;el!==null;lx+=el.offsetLeft,ly+=el.offsetTop,el=el.offsetParent){};
	return {x:lx,y:ly};
};

/**
 * Returns the distance of one of the sum of two distances in feet/miles with appropriate units
 * @param {Integer} distance1 The distance to convert
 * @param {Integer} opt_distance2 Optional second distance to add to first, and then convert
 */
GeometryControls.prototype.convertFromMetric = function(distance1, opt_distance2){
  var distance = opt_distance2 + distance1 || distance1;
  return (distance < 1609.344) ? (distance * 3.2808399).toFixed(2) + "ft" : (distance * 0.0006213711).toFixed(2) + "mi";
};   
        
/**
 * Wrapper function for GLog.write, allows debugging to be turned on/off globally
 * Note: debugging mode is set at instantiation, so that production mode does not incur processing
 * @param {Object} msg
 */
GeometryControls.prototype.debug = function(msg){
  var me = this, tempFunc;
  if(me.Options.debug){
    tempFunc = function(msg){
      GLog.write(msg);
    };
  } else {
    tempFunc = function(){};
  }
  me.debug = tempFunc;
  return tempFunc(msg);
};

/**
 * Serialize JSON to parameters
 * @param {Object} obj Object to serialize
 */
GeometryControls.prototype.serialize = function(obj){
  var me = this;
  var params = [];
  
  function traverseObject(myObj){
    for (var prop in myObj) {
      if (typeof(myObj[prop]) === "object") {
        traverseObject(myObj[prop]);
      } else {
        params.push(prop + "=" + myObj[prop]);      
      }
    }
  };
  
  traverseObject(obj);
  
  return params.join("&");
};

/**
 * Ajaxpect 0.9.0 (AOP)
 * http://code.google.com/p/ajaxpect
 * With slight formatting modifications (switched "_process" -> "process_", etc.)
 */
GeometryControls.prototype.aop = {
  addBefore: function(obj, filter, before) {
    var link = function(orig) {
      return function() {
        return orig.apply(this, before(arguments, orig, this));
      };
    };
    this.process_(obj, filter, link);
  },
  addAfter: function(obj, filter, after) {
    var link = function(orig) {
      return function() {
        return after(orig.apply(this, arguments), arguments, orig, this);
      };
    };
    this.process_(obj, filter, link);
  },
  addAround: function(obj, filter, around) {
    var link = function(orig) {
      return function() {
        return around(arguments, orig, this);
      };
    };
    this.process_(obj, filter, link);
  },  
  process_: function(obj, filter, link) {
    var check;
    if (filter.exec) {
      check = function(str) { return filter.exec(str); };
    } else if (filter.call) {
      check = function(str) { return filter.call(this, str); };
    }
    if (check) {
      for (var member in obj) {
        if (check(member)) {
          this.attach_(obj, member, link);
        }
      }
    } else {
      this.attach_(obj, filter, link);
    }
  },
  attach_: function(obj, member, link) {
    var orig = obj[member];
    obj[member] = link(orig);
  }  
};

