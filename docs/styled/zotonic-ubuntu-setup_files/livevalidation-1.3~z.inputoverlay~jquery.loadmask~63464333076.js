/* Zotonic basic Javascript library
----------------------------------------------------------

@package:	Zotonic 2009	
@Author:	Tim Benniks <tim@timbenniks.nl>
@Author:	Marc Worrell <marc@worrell.nl>

Copyright 2009-2011 Tim Benniks, Marc Worrell

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
 
http://www.apache.org/licenses/LICENSE-2.0
 
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Based on nitrogen.js which is copyright 2008-2009 Rusty Klophaus

---------------------------------------------------------- */

var z_ws					= false;
var z_ws_opened				= false;
var z_comet_is_running		= false;
var z_doing_postback		= false;
var z_spinner_show_ct		= 0;
var z_postbacks				= [];
var z_default_form_postback = false;
var z_input_updater			= false;
var z_drag_tag				= [];
var z_registered_events		= new Object();
var z_on_visible_checks		= [];
var z_on_visible_timer		= undefined;


/* Non modal dialogs
---------------------------------------------------------- */

function z_dialog_open(options)
{
	$('.dialog').remove();
	$.dialogAdd(options);
}

function z_dialog_close()
{
	$('.dialog-close').click();
}

/* Growl messages
---------------------------------------------------------- */

function z_growl_add(message, stay, type)
{
	stay = stay || false;
	type = type || 'notice';
	
	$.noticeAdd(
	{
		text: message,
		stay: stay,
		type: type
	});
	
	if(type == 'error' && window.console)
	{
		console.error(message);
	}
}

function z_growl_close()
{
	$.noticeRemove($('.notice-item-wrapper'), 400);
}


/* Registered events for javascript triggered actions/postbacks
---------------------------------------------------------- */

function z_event_register(name, func)
{
    z_registered_events[name] = func;
}

function z_event(name, extraParams)
{
	if (z_registered_events[name])
	{
		z_registered_events[name](ensure_name_value(extraParams));
	}
	else if (window.console)
	{
		console.error("z_event: no registered event named: '"+name+"'");
	}
}

/* Call the server side notifier for {postback_notify, Message, Context}
---------------------------------------------------------- */

function z_notify(message, extraParams)
{
	var extra = ensure_name_value(extraParams);
	if (typeof extra != 'object')
	{
		extra = [];
	}
	extra.push({name: 'z_msg', value: message});
	z_queue_postback('', z_default_notify_postback, extra, true);
}

/* Postback loop
---------------------------------------------------------- */

function z_postback_check() 
{
	if (z_postbacks.length == 0)
	{
		z_doing_postback = false;
	}
	else
	{
		if (z_postback_connected())
		{
			// Send only a single postback at a time.
			z_doing_postback = true;

			var o = z_postbacks.shift();
			z_do_postback(o.triggerID, o.postback, o.extraParams);
		}
		else
		{
			setTimeout("z_postback_check()", 10);
		}
	}
}

function z_opt_cancel(obj)
{
	if(typeof obj.nodeName == 'undefined')
		return false;

	var nodeName = obj.nodeName.toLowerCase();
	var nodeType = $(obj).attr("type");

	if (nodeName == 'input' &&	(nodeType == 'checkbox' || nodeType == 'radio'))
	{
		return true;
	}
	else
	{
		return false;
	}
}

function z_queue_postback(triggerID, postback, extraParams, noTriggerValue) 
{
	var triggerValue = '';

	if (triggerID != '' && !noTriggerValue)
	{
		var trigger = $('#'+triggerID).get(0);
		if (trigger)
		{
			if ($(trigger).is(":checkbox") || $(trigger).is(":radio"))
			{
				if ($(trigger).is(":checked"))
				{
					triggerValue = $(trigger).val() || 'on';
				}
			}
			else
			{
				var nodeName = trigger.nodeName.toLowerCase();
		
				if (nodeName == 'input' || nodeName == 'button' || nodeName == 'textarea' || nodeName == 'select')
					triggerValue = $(trigger).val() || '';
			}
		}
	}

	extraParams = extraParams || new Array(); 
	extraParams.push({name: 'triggervalue', value: triggerValue})
	
	var o			= new Object();
	o.triggerID		= triggerID;
	o.postback		= postback;
	o.extraParams	= extraParams;
	
	z_postbacks.push(o);
	z_postback_check();
}


// Wait with sending postbacks till the websocket connection is open
function z_postback_connected()
{
	return !z_ws || z_ws.readyState != 0;
}


function z_do_postback(triggerID, postback, extraParams) 
{
	// Get params...
	var params = 
		"postback=" + urlencode(postback) + 
		"&z_trigger_id=" + urlencode(triggerID) +
		"&z_pageid=" + urlencode(z_pageid) + 
		"&" + $.param(extraParams);
	
	// logon_form and .setcookie forms are always posted, as they will set cookies.
	if (   z_ws
		&& z_ws.readyState == 1 
		&& triggerID != "logon_form" 
		&& (triggerID == '' || !$('#'+triggerID).hasClass("setcookie")))
	{
		z_ws.send(params);
	}
	else
	{
		z_ajax(triggerID, params);
	}
}

function z_ajax(triggerID, params)
{
	z_start_spinner();

	$.ajax({ 
		url:		'/postback',
		type:		'post',
		data:		params,
		dataType:	'text',
		success: function(data, textStatus) 
		{
			z_stop_spinner();
			
			try 
			{
				eval(data);
				z_init_postback_forms();
			} 
			catch(e)
			{
				$.misc.error("Error evaluating ajax return value: " + data);
				$.misc.warn(e);
			}
			setTimeout("z_postback_check()", 0);
		},
		error: function(xmlHttpRequest, textStatus, errorThrown) 
		{
			z_stop_spinner();
			
			$.misc.error("FAIL: " + textStatus);
			z_unmask_error(triggerID);
		}
	});
}

function z_unmask(id)
{
	if (id)
	{
		var trigger = $('#'+id).get(0);
	
		if (trigger && trigger.nodeName.toLowerCase() == 'form') 
		{
			try { $(trigger).unmask(); } catch (e) {};
		}
		$(trigger).removeClass("z_error_upload");
	}
}


function z_unmask_error(id)
{
	if (id)
	{
		z_unmask(id);
		$('#'+id).addClass("z_error_upload");
	}
}


function z_progress(id, value)
{
	if (id)
	{
		var trigger = $('#'+id).get(0);
	
		if (trigger.nodeName.toLowerCase() == 'form') 
		{
			try { $(trigger).maskProgress(value); } catch (e) {};
		}
		
	}
}

/* tinyMCE stuff
---------------------------------------------------------- */

function z_tinymce_add(element) 
{
	if (typeof(tinyMCE) != 'undefined') {
		$("textarea.tinymce", element).each( function() { 
			var mce_id = $(this).attr('id');
			setTimeout(function() { tinyMCE.execCommand('mceAddControl',false, mce_id); }, 200);
		} );
	}
}

function z_tinymce_remove(element) 
{
	if (typeof(tinyMCE) != 'undefined') {
		$("textarea.tinymce", element).each( function() {
			tinyMCE.execCommand('mceRemoveControl',false, $(this).attr('id')); 
		} );
	}
}


/* Comet long poll or WebSockets connection
---------------------------------------------------------- */

function z_stream_start(host)
{
	if (!z_ws && !z_comet_is_running)
	{
		if ("WebSocket" in window && window.location.protocol == "http:") 
		{
			z_websocket_start(host);
		}
		else
		{
			setTimeout(function() { z_comet(host); }, 2000);
			z_comet_is_running = true;
		}
	}
}

function z_comet(host) 
{
	if (host != window.location.host && window.location.protocol == "http:")
	{
		var url = window.location.protocol + '//' + host + "/comet/subdomain?z_pageid=" + urlencode(z_pageid);
		var comet = $('<iframe id="z_comet_connection" name="z_comet_connection" src="'+url+'" />');
		comet.css({ position: 'absolute', top: '-1000px', left: '-1000px' });
		comet.appendTo("body");
	}
	else
	{
		z_comet_host()
	}
}

function z_comet_host()
{
	$.ajax({ 
		url: window.location.protocol + '//' + window.location.host + '/comet',
		type:'post',
		data: "z_pageid=" + urlencode(z_pageid),
		dataType: 'text',
		success: function(data, textStatus) 
		{
			z_comet_data(data);
			setTimeout(function() { z_comet_host(); }, 1000);
		},
		error: function(xmlHttpRequest, textStatus, errorThrown) 
		{
			setTimeout(function() { z_comet_host(); }, 1000);
		}
	});
}


function z_comet_data(data)
{
	try 
	{
		eval(data);
		z_init_postback_forms();
	} 
	catch (e)
	{
		$.misc.error("Error evaluating ajax return value: " + data);
		$.misc.warn(e);
	}
}


function z_websocket_start(host)
{
	z_ws = new WebSocket("ws://"+document.location.host+"/websocket?z_pageid="+z_pageid);

	z_ws.onopen = function() { z_ws_opened = true; };
	z_ws.onerror = function() {};

	z_ws.onclose = function (evt) 
	{
		if (z_ws_opened)
		{
			// Try to reopen, might be closed to error upstream
			setTimeout(function() { z_websocket_start(host); }, 10);
		}
		else
		{
			// Failed opening websocket connection - try to start comet
			z_ws = undefined;
			setTimeout(function() { z_comet(host); }, 2000);
			z_comet_is_running = true;
		}
	};

	z_ws.onmessage = function (evt)
	{
		z_comet_data(evt.data);
		setTimeout("z_postback_check()", 0);
	};
}


/* Utility functions
---------------------------------------------------------- */

function z_is_enter_key(event) 
{
	return (event && event.keyCode == 13);
}


/* Spinner, show when waiting for a postback
---------------------------------------------------------- */

function z_start_spinner()
{
	if (z_spinner_show_ct++ == 0)
	{
		$(document.body).addClass('wait');
		$('#spinner').fadeIn(100);
	}
}

function z_stop_spinner() 
{
	if (--z_spinner_show_ct == 0)
	{
		$('#spinner').fadeOut(100);
		$(document.body).removeClass('wait');
	}
}


/* Drag & drop interface to the postback
---------------------------------------------------------- */

function z_draggable(dragObj, dragOptions, dragTag) 
{
	dragObj.draggable(dragOptions).data("z_drag_tag", dragTag);
	z_drag_tag[dragObj.attr('id')] = dragTag;
}

function z_droppable(dropObj, dropOptions, dropPostbackInfo) 
{
	dropOptions.greedy = true;
	dropOptions.drop = function(ev, ui) 
	{
		var dragTag = $(ui.draggable[0]).data("z_drag_tag");
		var dragItem = new Array({name: 'drag_item', value: dragTag});
		z_queue_postback(this.id, dropPostbackInfo, dragItem, true);
	};

	$(dropObj).droppable(dropOptions);
}


/* Sorter and sortables interface to the postback
---------------------------------------------------------- */

function z_sortable(sortableObj, sortTag) 
{
	sortableObj.data("z_sort_tag", sortTag);
}

function z_sorter(sortBlock, sortOptions, sortPostbackInfo) 
{
	sortOptions.update = function() 
	{
		var sortItems = "";

		for (var i = 0; i < this.childNodes.length; i++) 
		{
			var sortTag = $(this.childNodes[i]).data("z_sort_tag") 
			if (!sortTag && this.childNodes[i].id)
			{
				sortTag = z_drag_tag[this.childNodes[i].id];
			}
			if (sortTag)
			{
				if (sortItems != "") 
				{
					sortItems += ",";
				}
				
				sortItems += sortTag
			}
		}
		
		var sortItem = new Array({name: 'sort_items', value: sortItems});
		
		z_queue_postback(this.id, sortPostbackInfo, sortItem, true);
	};

	$(sortBlock).sortable(sortOptions);
}


/* typeselect input field
---------------------------------------------------------- */

function z_typeselect(ElementId, postbackInfo)
{
	if (z_input_updater)
	{
		clearTimeout(z_input_updater);
		z_input_updater = false;
	}
	
	z_input_updater = setTimeout(function()
	{
		var obj = $('#'+ElementId);

		if(obj.val().length >= 2)
		{
			obj.addClass('loading');
			z_queue_postback(ElementId, postbackInfo)
		}
	}, 400);
}


/* Lazy loading of content, based on visibility of an element
---------------------------------------------------------- */

function z_on_visible(CssSelector, Func)
{
	z_on_visible_checks.push({selector: CssSelector, func: Func});
	if (z_on_visible_timer == undefined) {
		z_on_visible_timer = setInterval(function() {
			z_on_visible_check();
		}, 350);
	}
}

function z_on_visible_check()
{
	for (var i = z_on_visible_checks.length-1; i>=0; i--) {
		var elt = $(z_on_visible_checks[i].selector).get(0);
		if (elt != undefined) {
			if ($(elt).is(":visible") && isScrolledIntoView(elt)) {
				z_on_visible_checks[i].func.call(elt);
				z_on_visible_checks.splice(i, 1);
			}
		}
	}
	if (z_on_visible_checks.length == 0) {
		clearInterval(z_on_visible_timer);
		z_on_visible_timer = undefined;
	}
}


function isScrolledIntoView(elem)
{
	var docViewTop = $(window).scrollTop();
	var docViewBottom = docViewTop + $(window).height();

	var elemTop = $(elem).offset().top;
	var elemBottom = elemTop + $(elem).height();

	return (elemBottom >= docViewTop) && (elemTop <= docViewBottom);
	// && (elemBottom <= docViewBottom) &&  (elemTop >= docViewTop);
}

/* Form element validations
----------------------------------------------------------

Grab all "postback" forms, let them be handled by Ajax postback calls.
This function can be run multiple times.

---------------------------------------------------------- */

function z_init_postback_forms()
{
	$("form[action*='postback']").each(function() 
	{
		// store options in hash
		$(":submit,input:image", this).bind('click.form-plugin',function(e) 
		{
			var form = this.form;
			form.clk = this;
		
			if (this.type == 'image') 
			{
				if (e.offsetX != undefined) 
				{
					form.clk_x = e.offsetX;
					form.clk_y = e.offsetY;
				} 
				else if (typeof $.fn.offset == 'function') 
				{ // try to use dimensions plugin
					var offset = $(this).offset();
					form.clk_x = e.pageX - offset.left;
					form.clk_y = e.pageY - offset.top;
				} 
				else 
				{
					form.clk_x = e.pageX - this.offsetLeft;
					form.clk_y = e.pageY - this.offsetTop;
				}
			}
		});
	})
	.submit(function(event)
	{
		theForm = this;
		
		if ($('.tinymce', theForm).length > 0 && tinyMCE)
		{
			tinyMCE.triggerSave(true,true);
		}
		
		submitFunction = function(ev) {
			var arguments = $(theForm).formToArray();

			try { $(theForm).mask("", 100); } catch (e) {};
			theForm.clk = theForm.clk_x = theForm.clk_y = null;

			var postback	= $(theForm).data("z_submit_postback");
			var action		= $(theForm).data("z_submit_action");
			var form_id		= $(theForm).attr('id');
			var validations = $(theForm).formValidationPostback();
		
			if(!postback) 
			{
				postback = z_default_form_postback;
			}
		
			if(action) 
			{
				setTimeout(action, 10);
			}

			var use_post = $(theForm).hasClass("z_cookie_form");
			if (typeof(z_only_post_forms) != "undefined" && z_only_post_forms)
			{
				use_post = true;
			}
			else
			{
				var files = $('input:file', theForm).fieldValue();
				for (var j=0; j < files.length && !use_post; j++) 
				{
					if (files[j])
					{
						use_post = true;
					}
				}
			}
		
			if (use_post) 
			{
				$(theForm).postbackFileForm(form_id, postback, validations);
			}
			else
			{
				z_queue_postback(form_id, postback, arguments.concat(validations)); 
			}
			ev.stopPropagation();
			return false;
		};
		
		return z_form_submit_validated_delay(theForm, event, submitFunction);
	})
	.attr('action', '#pb-installed');
}

function z_form_submit_validated_delay(theForm, event, submitFunction) 
{
	var validations = $(theForm).formValidationPostback();
	
	if (validations.length > 0 && !event.zIsValidated)
	{
		// There are form validations and they are not done yet.
		if (!event.zAfterValidation) 
		{
			event.zAfterValidation = new Array();
		}
		event.zAfterValidation.push({ func: submitFunction, context: theForm });
		return true;
	}
	else
	{
		// No form validations, or already validated
		return submitFunction.call(theForm, event);
	}
}

function z_form_submit_validated_do(event)
{
	var ret = true;
	
	if (event.zAfterValidation)
	{
		for (var f in event.zAfterValidation) 
		{
			ret = event.zAfterValidation[f].func.call(f.context, event) && ret;
		}
		event.zAfterValidation = new Array();
	}
	return ret;
}


$.fn.postbackFileForm = function(trigger_id, postback, validations)
{
	var a = validations;

	a.push({name: "postback", value: postback});
	a.push({name: "z_trigger_id", value: trigger_id});
	a.push({name: "z_pageid", value: z_pageid});
	a.push({name: "z_comet", value: z_comet_is_running || z_ws});
	
	var $form = this;
	var options = {
		url:  '/postback?' + $.param(a),
		type: 'POST',
		dataType: 'text/javascript'
	};

	// hack to fix Safari hang (thanks to Tim Molendijk for this)
	// see:	 http://groups.google.com/group/jquery-dev/browse_thread/thread/36395b7ab510dd5d
	if ($.browser.safari)
		$.get('/close-connection', fileUpload);
	else
		fileUpload();
	
	// private function for handling file uploads (hat tip to YAHOO!)
	function fileUpload() {
		var form = $form[0];

		if ($(':input[name=submit]', form).length) {
			alert('Error: Form elements must not be named "submit".');
			return;
		}

		var opts = $.extend({}, $.ajaxSettings, options);
		var s = $.extend(true, {}, $.extend(true, {}, $.ajaxSettings), opts);

		var id = 'jqFormIO' + (new Date().getTime());
		var $io = $('<iframe id="' + id + '" name="' + id + '" src="about:blank" />');
		var io = $io[0];

		$io.css({ position: 'absolute', top: '-1000px', left: '-1000px' });

		var xhr = { // mock object
			aborted: 0,
			responseText: null,
			responseXML: null,
			status: 0,
			statusText: 'n/a',
			getAllResponseHeaders: function() {},
			getResponseHeader: function() {},
			setRequestHeader: function() {},
			abort: function() {
				this.aborted = 1;
				$io.attr('src','about:blank'); // abort op in progress
			}
		};

		var g = opts.global;
		
		// trigger ajax global events so that activity/block indicators work like normal
		if (g && ! $.active++) $.event.trigger("ajaxStart");
		if (g) $.event.trigger("ajaxSend", [xhr, opts]);

		if (s.beforeSend && s.beforeSend(xhr, s) === false) {
			s.global && $.active--;
			return;
		}
		if (xhr.aborted)
			return;

		var cbInvoked = 0;
		var timedOut = 0;

		// add submitting element to data if we know it
		var sub = form.clk;
		if (sub) {
			var n = sub.name;
			if (n && !sub.disabled) {
				options.extraData = options.extraData || {};
				options.extraData[n] = sub.value;
				if (sub.type == "image") {
					options.extraData[name+'.x'] = form.clk_x;
					options.extraData[name+'.y'] = form.clk_y;
				}
			}
		}

		// take a breath so that pending repaints get some cpu time before the upload starts
		setTimeout(function() {
			// make sure form attrs are set
			var t = $form.attr('target');
			var a = $form.attr('action');

			// update form attrs in IE friendly way
			form.setAttribute('target',id);
			if (form.getAttribute('method') != 'POST')
				form.setAttribute('method', 'POST');
			if (form.getAttribute('action') != opts.url)
				form.setAttribute('action', opts.url);

			// ie borks in some cases when setting encoding
			if (! options.skipEncodingOverride) {
				$form.attr({
					encoding: 'multipart/form-data',
					enctype:  'multipart/form-data'
				});
			}

			// support timout
			if (opts.timeout)
				setTimeout(function() { timedOut = true; cb(); }, opts.timeout);

			// add "extra" data to form if provided in options
			var extraInputs = [];
			try {
				if (options.extraData)
					for (var n in options.extraData)
						extraInputs.push(
							$('<input type="hidden" name="'+n+'" value="'+options.extraData[n]+'" />')
								.appendTo(form)[0]);
				
				// add iframe to doc and submit the form
				$io.appendTo('body');
				io.attachEvent ? io.attachEvent('onload', cb) : io.addEventListener('load', cb, false);
				form.submit();
			}
			finally {
				// reset attrs and remove "extra" input elements
				form.setAttribute('action',a);
				t ? form.setAttribute('target', t) : $form.removeAttr('target');
				$(extraInputs).remove();
			}
		}, 10);

		var domCheckCount = 3;

		function cb() {
			if (cbInvoked++) return;

			io.detachEvent ? io.detachEvent('onload', cb) : io.removeEventListener('load', cb, false);

			var ok = true;
			try {
				if (timedOut) throw 'timeout';
				// extract the server response from the iframe
				var data, doc;

				doc = io.contentWindow ? io.contentWindow.document : io.contentDocument ? io.contentDocument : io.document;
				if (doc.body == null || doc.body.innerHTML == '') {
					if (--domCheckCount) {
						// in some browsers (Opera) the iframe DOM is not always traversable when
						// the onload callback fires, so we loop a bit to accommodate

						// MW: looks like this is not a timing issue but Opera triggering a
						//	   load event on the 100 continue.
						cbInvoked = 0;
						io.addEventListener('load', cb, false);
						return;
					}
					log('Could not access iframe DOM after 50 tries.');
					return;
				}

				xhr.responseText = doc.body ? doc.body.innerHTML : null;
				
				xhr.getResponseHeader = function(header){
					var headers = {'content-type': opts.dataType};
					return headers[header];
				};

				var ta = doc.getElementsByTagName('textarea')[0];
				xhr.responseText = ta ? ta.value : xhr.responseText;
				data = $.httpData(xhr, opts.dataType);
			}
			catch(e){
				ok = false;
				$.handleError(opts, xhr, 'error', e);
			}
			
			// ordering of these callbacks/triggers is odd, but that's how $.ajax does it
			if (ok) {
				try {
					eval(data);
				} catch (e) {
					z_unmask_error(form.id);
				}
				if (g) 
				{
					$.event.trigger("ajaxSuccess", [xhr, opts]);
				}
			} else {
				z_unmask_error(form.id);
			}
			if (g) $.event.trigger("ajaxComplete", [xhr, opts]);
			if (g && ! --$.active) $.event.trigger("ajaxStop");
			if (opts.complete) opts.complete(xhr, ok ? 'success' : 'error');

			// clean up
			setTimeout(function() {
				$io.remove();
				xhr.responseXML = null;
			}, 100);
		};
	};
}


// Collect all postback validations from the form elements
$.fn.formValidationPostback = function() 
{
	var a = [];
	if(this.length == 0) return a;

	var form = this[0];
	var els	 = form.elements;

	if (!els) return a;

	for(var i=0, max=els.length; i < max; i++) 
	{
		var el = els[i];
		var n  = el.name;

		if (n && !el.disabled)
		{
			var v = $(el).data("z_postback_validation");
			if (v)
			{
				a.push({name: "z_v", value: n+":"+v})
			}
		}
	}
	return a;
}

// Initialize a validator for the element #id
function z_init_validator(id, args)
{
	var elt = $('#'+id);
	if (elt)
	{
		if (elt.attr('type') == 'radio')
		{
			$('input[name='+elt.attr('name')+']').each(function() {
				if (!$(this).data("z_live_validation"))
					$(this).data("z_live_validation", new LiveValidation($(this).attr('id'), args));
			});
		}
		else if (!$(elt).data("z_live_validation"))
		{
			$(elt).data("z_live_validation", new LiveValidation(id, args));
		}
	}
	else
	{
		$.misc.error('Validator error: no element with id #'+id, $(id));
	}
}

// Add a validator to the input field
function z_add_validator(id, type, args)
{
	var elt = $('#'+id);
	
	if (elt.attr('type') == 'radio')
		elt = $('input[name='+elt.attr('name')+']');

	elt.each(function() {
		var v = $(this).data("z_live_validation");

		if (v)
		{
			if (args['pattern'])
			{
				args['pattern'] = new RegExp(args['pattern']);
			}
			switch (type)
			{
				case 'email':			v.add(Validate.Email, args);		break;
				case 'presence':		v.add(Validate.Presence, args);		break;
				case 'confirmation':	v.add(Validate.Confirmation, args); break;
				case 'acceptance':		v.add(Validate.Acceptance, args);	break;
				case 'length':			v.add(Validate.Length, args);		break;
				case 'format':			v.add(Validate.Format, args);		break;
				case 'numericality':	v.add(Validate.Numericality, args); break;
				case 'postback':		
					args['z_id'] = id;
					v.add(Validate.Postback, args);
					break;
				default:
					$.misc.error("unknown validation: "+type);
					break;
			}
		}
	});
}

function z_set_validator_postback(id, postback)
{
	if (postback)
	{
		var pb = $('#'+id).data("z_postback_validation");
		
		if (pb)
		{
			$.misc.error("Element #"+id+" had already a validation postback, add all validations as one batch.", $('#' +id));
		}

		$('#'+id).data("z_postback_validation", postback);
	}
}

function z_validation_on_invalid(id, on_invalid)
{
	$('#'+id).each(function() {
		if (this.tagName.toLowerCase() == 'form')
		{
			var formObj = LiveValidationForm.getInstance(this);
			formObj.onInvalid = on_invalid;
		}
	});
}


function z_async_validation_result(id, isValid, testedValue)
{
	var v = $('#'+id).data("z_live_validation");

	if (v && $('#'+id).val() == testedValue)
	{
		v.asyncValidationResult(isValid, testedValue);
	}
}

// Called by the server on validation errors
function z_validation_error(id, error)
{
	var v = $('#'+id).data("z_live_validation");
	if (v)
	{
		if (error == 'invalid')
		{
			// Generic error - handle it ourselves
			error = "please correct";
		}
		v.showErrorMessage(error);
	}
}

// URL encode function that is more RFC compatible.	 Also encodes +, *, / and @.
function urlencode(s)
{
	s = escape(s);
	s = s.replace(/\+/g, '%2B');
	s = s.replace(/\*/g, '%2A');
	s = s.replace(/\//g, '%2F');
	s = s.replace(/@/g, '%40');
	return s;
}

// HTML escape a string so it is safe to concatenate when making tags.
function html_escape(s)
{
	s.replace(/&/, "&amp;").replace(/</, "&lt;").replace(/>/, "&gt;").replace(/"/, "&quot;");
}


// Convert an object to an array with {name: xxx, value: yyy} pairs
function ensure_name_value(a)
{
	if ((typeof a == 'object') && !(a instanceof Array))
	{
		var n = []
		for (var prop in a)
		{
			n.push({name: prop, value: a[prop]});
		}
		return n;
	}
	else
	{
		return a;
	}
}

// From: http://malsup.com/jquery/form/jquery.form.js

/*
 * jQuery Form Plugin
 * version: 2.28 (10-MAY-2009)
 * @requires jQuery v1.2.2 or later
 *
 * Examples and documentation at: http://malsup.com/jquery/form/
 * Dual licensed under the MIT and GPL licenses:
 *	 http://www.opensource.org/licenses/mit-license.php
 *	 http://www.gnu.org/licenses/gpl.html
 */

/**
 * formToArray() gathers form element data into an array of objects that can
 * be passed to any of the following ajax functions: $.get, $.post, or load.
 * Each object in the array has both a 'name' and 'value' property.	 An example of
 * an array for a simple login form might be:
 *
 * [ { name: 'username', value: 'jresig' }, { name: 'password', value: 'secret' } ]
 *
 * It is this array that is passed to pre-submit callback functions provided to the
 * ajaxSubmit() and ajaxForm() methods.
 */
$.fn.formToArray = function(semantic) {
	var a = [];
	if (this.length == 0) return a;

	var form = this[0];
	var els = semantic ? form.getElementsByTagName('*') : form.elements;
	if (!els) return a;
	for(var i=0, max=els.length; i < max; i++) {
		var el = els[i];
		var n = el.name;
		if (!n) continue;
		if ($(el).hasClass("nosubmit")) continue;
		if ($(el).attr("type") == 'submit') continue;

		var v = $.fieldValue(el, true);
		if (v && v.constructor == Array) {
			for(var j=0, jmax=v.length; j < jmax; j++)
				a.push({name: n, value: v[j]});
		}
		else if (v !== null && typeof v != 'undefined')
			a.push({name: n, value: v});
	}

	// add submitting element to data if we know it
	var sub = form.clk;
	if (sub) {
		var n = sub.name;
		if (n && !sub.disabled) {
			a.push({name: n, value: ''});
			a.push({name: 'z_submitter', value: n});
		}
	}

	return a;
};

/**
 * Serializes form data into a 'submittable' string. This method will return a string
 * in the format: name1=value1&amp;name2=value2
 */
$.fn.formSerialize = function(semantic) {
	//hand off to jQuery.param for proper encoding
	return $.param(this.formToArray(semantic));
};

/**
 * Serializes all field elements in the jQuery object into a query string.
 * This method will return a string in the format: name1=value1&amp;name2=value2
 */
$.fn.fieldSerialize = function(successful) {
	var a = [];
	this.each(function() {
		var n = this.name;
		if (!n) return;
		var v = $.fieldValue(this, successful);
		if (v && v.constructor == Array) {
			for (var i=0,max=v.length; i < max; i++)
				a.push({name: n, value: v[i]});
		}
		else if (v !== null && typeof v != 'undefined')
			a.push({name: this.name, value: v});
	});
	//hand off to jQuery.param for proper encoding
	return $.param(a);
};

/**
 * Returns the value(s) of the element in the matched set.	For example, consider the following form:
 *
 *	<form><fieldset>
 *		<input name="A" type="text" />
 *		<input name="A" type="text" />
 *		<input name="B" type="checkbox" value="B1" />
 *		<input name="B" type="checkbox" value="B2"/>
 *		<input name="C" type="radio" value="C1" />
 *		<input name="C" type="radio" value="C2" />
 *	</fieldset></form>
 *
 *	var v = $(':text').fieldValue();
 *	// if no values are entered into the text inputs
 *	v == ['','']
 *	// if values entered into the text inputs are 'foo' and 'bar'
 *	v == ['foo','bar']
 *
 *	var v = $(':checkbox').fieldValue();
 *	// if neither checkbox is checked
 *	v === undefined
 *	// if both checkboxes are checked
 *	v == ['B1', 'B2']
 *
 *	var v = $(':radio').fieldValue();
 *	// if neither radio is checked
 *	v === undefined
 *	// if first radio is checked
 *	v == ['C1']
 *
 * The successful argument controls whether or not the field element must be 'successful'
 * (per http://www.w3.org/TR/html4/interact/forms.html#successful-controls).
 * The default value of the successful argument is true.  If this value is false the value(s)
 * for each element is returned.
 *
 * Note: This method *always* returns an array.	 If no valid value can be determined the
 *		 array will be empty, otherwise it will contain one or more values.
 */
$.fn.fieldValue = function(successful) {
	for (var val=[], i=0, max=this.length; i < max; i++) {
		var el = this[i];
		var v = $.fieldValue(el, successful);
		if (v === null || typeof v == 'undefined' || (v.constructor == Array && !v.length))
			continue;
		v.constructor == Array ? $.merge(val, v) : val.push(v);
	}
	return val;
};

/**
 * Returns the value of the field element.
 */
$.fieldValue = function(el, successful) {
	var n = el.name, t = el.type, tag = el.tagName.toLowerCase();
	if (typeof successful == 'undefined') successful = true;

	if (successful && (!n || el.disabled || t == 'reset' || t == 'button' ||
		t == 'radio' && !el.checked ||
		(t == 'submit' || t == 'image') && el.form && el.form.clk != el ||
		tag == 'select' && el.selectedIndex == -1))
			return null;
	
	// Return empty value for non-checked checkboxes
	if (successful && t == 'checkbox' && !el.checked)
		return '';

	if (tag == 'select') {
		var index = el.selectedIndex;
		if (index < 0) return null;
		var a = [], ops = el.options;
		var one = (t == 'select-one');
		var max = (one ? index+1 : ops.length);
		for(var i=(one ? index : 0); i < max; i++) {
			var op = ops[i];
			if (op.selected) {
				var v = op.value;
				if (!v) // extra pain for IE...
					v = (op.attributes && op.attributes['value'] && !(op.attributes['value'].specified)) ? op.text : op.value;
				if (one) return v;
				a.push(v);
			}
		}
		return a;
	}
	return el.value;
};


/**
 * Clears the form data.  Takes the following actions on the form's input fields:
 *	- input text fields will have their 'value' property set to the empty string
 *	- select elements will have their 'selectedIndex' property set to -1
 *	- checkbox and radio inputs will have their 'checked' property set to false
 *	- inputs of type submit, button, reset, and hidden will *not* be effected
 *	- button elements will *not* be effected
 */
$.fn.clearForm = function() {
	return this.each(function() {
		$('input,select,textarea', this).clearFields();
	});
};

/**
 * Clears the selected form elements.
 */
$.fn.clearFields = $.fn.clearInputs = function() {
	return this.each(function() {
		var t = this.type, tag = this.tagName.toLowerCase();
		if (t == 'text' || t == 'password' || tag == 'textarea')
			this.value = '';
		else if (t == 'checkbox' || t == 'radio')
			this.checked = false;
		else if (tag == 'select')
			this.selectedIndex = -1;
	});
};

/**
 * Resets the form data.  Causes all form elements to be reset to their original value.
 */
$.fn.resetForm = function() {
	return this.each(function() {
		// guard against an input with the name of 'reset'
		// note that IE reports the reset function as an 'object'
		if (typeof this.reset == 'function' || (typeof this.reset == 'object' && !this.reset.nodeType))
			this.reset();
	});
};

/**
 * Enables or disables any matching elements.
 */
$.fn.enable = function(b) {
	if (b == undefined) b = true;
	return this.each(function() {
		this.disabled = !b;
	});
};

/**
 * Checks/unchecks any matching checkboxes or radio buttons and
 * selects/deselects and matching option elements.
 */
$.fn.selected = function(select) {
	if (select == undefined) select = true;
	return this.each(function() {
		var t = this.type;
		if (t == 'checkbox' || t == 'radio')
			this.checked = select;
		else if (this.tagName.toLowerCase() == 'option') {
			var $sel = $(this).parent('select');
			if (select && $sel[0] && $sel[0].type == 'select-one') {
				// deselect all other options
				$sel.find('option').selected(false);
			}
			this.selected = select;
		}
	});
};

// helper fn for console logging
// set $.fn.ajaxSubmit.debug to true to enable debug logging
function log() {
	if (window.console && window.console.log)
		window.console.log('[jquery.form] ' + Array.prototype.join.call(arguments,''));
}

;
/* Admin widgetManager class
----------------------------------------------------------

@package:	Zotonic 2009	
@Author: 	Tim Benniks <tim@timbenniks.nl>

Copyright 2009 Tim Benniks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
 
http://www.apache.org/licenses/LICENSE-2.0
 
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

---------------------------------------------------------- */

;(function($)
{
	$.extend(
	{
		widgetManager: function(context)
		{
			context 	= context || document.body;
			var stack 	= [context];

			while(stack.length > 0)
			{
				var objectClass, objectOptions, functionName, defaults, element = stack.pop();
				
				if(element.className && (objectClass = new RegExp("do_([\\w_]+)", "g").exec(element.className)))
				{
					functionName = objectClass[1];
					
					if(typeof $(element)[functionName] == "function")
					{
						if($.ui && $.ui[functionName] && $.ui[functionName].defaults)
						{
							defaults = $.ui[functionName].defaults;
						}
						else
						{
							defaults = {}
						}
						
						objectOptions = $.extend({}, defaults, $(element).metadata());
						$(element)[functionName](objectOptions);
					}
				}

				if(element.childNodes) 
				{
				    for(var i = 0; i< element.childNodes.length; i++)
					{
						if(element.childNodes[i].nodeType != 3)
						{
							stack.unshift(element.childNodes[i]);
						}
					}
				}
			}
		},
		
		misc: 
		{
			log: function(obj)
			{
				if(window.console) 
				{
					console.log(obj);
	
					if($.noticeAdd)
					{
						$.noticeAdd({
							text: 'Logging, check firebug: '+obj, 
							type: 'notice', 
							stay: 0
						});
					}
				} 
				else 
				{
					if($.noticeAdd)
					{
						$.noticeAdd({
							text: 'logged: '+obj, 
							type: 'notice', 
							stay: 0
						});
					}
					else
					{
						alert(obj.toSource());
					}
				}
			},
			
			warn: function(text, obj)
			{
				obj = obj || '';
				
				if(window.console) 
				{
					console.warn(text, obj);
				}
				
				if($.noticeAdd)
				{
					$.noticeAdd({
						text: text, 
						type: 'notice', 
						stay: 1
					});
				}
			},
			
			error: function(text, obj)
			{
				obj = obj || '';

				if(window.console) 
				{
					console.error(text, obj);
				}
				
				if($.noticeAdd)
				{
					$.noticeAdd({
						text: text, 
						type: 'error', 
						stay: 1
					});
				}
			}
		},
		
		metadata: 
		{
			defaults: {
				type: 'class',
				name: 'metadata',
				cre: /({.*})/,
				single: 'metadata'
			},
			
			setType: function(type, name)
			{
				this.defaults.type = type;
				this.defaults.name = name;
			},
			
			get: function(elem, opts)
			{
				var settings = $.extend({}, this.defaults, opts);
				
				// check for empty string in single property
				if(!settings.single.length)
				{
					settings.single = 'metadata';
				}
				
				var data = $.data(elem, settings.single);
				
				// returned cached data if it already exists
				if(data)
				{
					return data;
				}
				
				data = "{}";
				
				if(settings.type == "class")
				{
					var m = settings.cre.exec(elem.className);
					if(m)
					{
						data = m[1];
					}
				} 
				else if(settings.type == "elem")
				{
					if(!elem.getElementsByTagName)
					{
						return;
					}
					
					var e = elem.getElementsByTagName(settings.name);
					
					if(e.length)
					{
						data = $.trim(e[0].innerHTML);
					}
				} 
				else if(elem.getAttribute != undefined)
				{
					var attr = elem.getAttribute(settings.name);
					if(attr)
					{
						data = attr;
					}
				}
				
				if(data.indexOf( '{' ) < 0)
				data = "{" + data + "}";
				
				data = eval("(" + data + ")");
				
				$.data(elem, settings.single, data);
				return data;
			}
		}
	});
	
	$.fn.metadata = function(opts)
	{
		return $.metadata.get( this[0], opts );
	};
    
	$.fn.widgetManager = function(opts)
	{
	    $.widgetManager(this[0]);
	};

})(jQuery);;
// LiveValidation 1.3 (standalone version)
// Copyright (c) 2007-2008 Alec Hill (www.livevalidation.com)
// LiveValidation is licensed under the terms of the MIT License

// MW: 20100316: Adapted for async usage with Zotonic.
// MW: 20100629: Added support for presence check on radio buttons


/*********************************************** LiveValidation class ***********************************/

/**
 *  validates a form field in real-time based on validations you assign to it
 *  
 *  @var element {mixed} - either a dom element reference or the string id of the element to validate
 *  @var optionsObj {Object} - general options, see below for details
 *
 *  optionsObj properties:
 *              validMessage {String}   - the message to show when the field passes validation
 *                            (DEFAULT: "Thankyou!")
 *              onAsync {Function}    - function to execute when field passes is waiting for async validation
 *                            (DEFAULT: function(){ this.insertMessage(this.createSpinnerSpan()); this.addFieldClass(); } ) 
 *              onValid {Function}    - function to execute when field passes validation
 *                            (DEFAULT: function(){ this.insertMessage(this.createMessageSpan()); this.addFieldClass(); } ) 
 *              onInvalid {Function}  - function to execute when field fails validation
 *                            (DEFAULT: function(){ this.insertMessage(this.createMessageSpan()); this.addFieldClass(); })
 *              insertAfterWhatNode {Int}   - position to insert default message
 *                            (DEFAULT: the field that is being validated)  
 *              onlyOnBlur {Boolean} - whether you want it to validate as you type or only on blur
 *                            (DEFAULT: false)
 *              wait {Integer} - the time you want it to pause from the last keystroke before it validates (ms)
 *                            (DEFAULT: 0)
 *              onlyOnSubmit {Boolean} - whether should be validated only when the form it belongs to is submitted
 *                            (DEFAULT: false)            
 */

var LiveValidation = function(element, optionsObj){
    this.initialize(element, optionsObj);
}

LiveValidation.VERSION = '1.3 standalone';

/** element types constants ****/

LiveValidation.TEXTAREA = 1;
LiveValidation.TEXT     = 2;
LiveValidation.PASSWORD = 3;
LiveValidation.CHECKBOX = 4;
LiveValidation.SELECT   = 5;
LiveValidation.FILE     = 6;
LiveValidation.RADIO    = 7;


/****** prototype ******/

LiveValidation.prototype = 
{

    validClass: 'z_valid',
    invalidClass: 'z_invalid',
    messageClass: 'z_validation_message',
    validFieldClass: 'z_valid_field',
    invalidFieldClass: 'form-field-error',
    asyncFieldClass: 'z_async_validation',

    /**
     *  initialises all of the properties and events
     *
     * @var - Same as constructor above
     */
    initialize: function(element, optionsObj){
      var self = this;
      if(!element)
        throw new Error("LiveValidation::initialize - No element reference or element id has been provided!");
      this.element = element.nodeName ? element : document.getElementById(element);
      if(!this.element) 
        throw new Error("LiveValidation::initialize - No element with reference or id of '" + element + "' exists!");
      // default properties that could not be initialised above
      this.validations = [];
      this.elementType = this.getElementType();
      this.form = this.element.form;
      // options
      var options = optionsObj || {};
      this.validMessage = options.validMessage || '';
      var node = options.insertAfterWhatNode || this.element;
      this.insertAfterWhatNode = node.nodeType ? node : document.getElementById(node);
      this.onAsync = options.onAsync || function(){ this.insertSpinner(this.createSpinnerSpan()); this.addFieldClass(); };
      this.onValid = options.onValid || function(){ this.insertMessage(this.createMessageSpan()); this.addFieldClass(); };
      this.onInvalid = options.onInvalid || function(){ this.insertMessage(this.createMessageSpan()); this.addFieldClass(); };  
      this.onlyOnBlur =  options.onlyOnBlur || false;
      this.wait = options.wait || 0;
      this.onlyOnSubmit = options.onlyOnSubmit || false;
      this.validationAsync = false;
      
      // add to form if it has been provided
      if(this.form){
        this.formObj = LiveValidationForm.getInstance(this.form);
        this.formObj.addField(this);
      }
      // events
      // collect old events
      this.oldOnFocus = this.element.onfocus || function(){};
      this.oldOnBlur = this.element.onblur || function(){};
      this.oldOnClick = this.element.onclick || function(){};
      this.oldOnChange = this.element.onchange || function(){};
      this.oldOnKeyup = this.element.onkeyup || function(){};
      this.element.onfocus = function(e){ self.doOnFocus(e); return self.oldOnFocus.call(this, e); }
      if(!this.onlyOnSubmit){
        switch(this.elementType){
          case LiveValidation.RADIO:
          case LiveValidation.CHECKBOX:
            this.element.onclick = function(e){ self.validate(); return self.oldOnClick.call(this, e); }
          // let it run into the next to add a change event too
          case LiveValidation.SELECT:
          case LiveValidation.FILE:
            this.element.onchange = function(e){ self.validate(); return self.oldOnChange.call(this, e); }
            break;
          default:
            if(!this.onlyOnBlur) this.element.onkeyup = function(e){ self.deferValidation(); return self.oldOnKeyup.call(this, e); }
            this.element.onblur = function(e){ self.doOnBlur(e); return self.oldOnBlur.call(this, e); }
        }
      }
    },
  
    /**
     *  destroys the instance's events (restoring previous ones) and removes it from any LiveValidationForms
     */
    destroy: function(){
        if(this.formObj){
            // remove the field from the LiveValidationForm
            this.formObj.removeField(this);
            // destroy the LiveValidationForm if no LiveValidation fields left in it
            this.formObj.destroy();
        }
        // remove events - set them back to the previous events
        this.element.onfocus = this.oldOnFocus;
        if(!this.onlyOnSubmit){
            switch(this.elementType){
              case LiveValidation.RADIO:
              case LiveValidation.CHECKBOX:
                this.element.onclick = this.oldOnClick;
              // let it run into the next to add a change event too
              case LiveValidation.SELECT:
              case LiveValidation.FILE:
                this.element.onchange = this.oldOnChange;
                break;
              default:
                if(!this.onlyOnBlur) this.element.onkeyup = this.oldOnKeyup;
                this.element.onblur = this.oldOnBlur;
            }
        }
        this.validations = [];
        this.removeMessageAndFieldClass();
    },
    
    /**
     * Adds a validation to perform to a LiveValidation object
     *
     * @var validationFunction {Function} - validation function to be used (ie Validate.Presence )
     * @var validationParamsObj {Object} - parameters for doing the validation, if wanted or necessary
     * @return {Object} - the LiveValidation object itself so that calls can be chained
     */
    add: function(validationFunction, validationParamsObj){
      this.validations.push( {type: validationFunction, params: validationParamsObj || {} } );
      return this;
    },
    
    /**
     * Removes a validation from a LiveValidation object - must have exactly the same arguments as used to add it 
     *
     * @var validationFunction {Function} - validation function to be used (ie Validate.Presence )
     * @var validationParamsObj {Object} - parameters for doing the validation, if wanted or necessary
     * @return {Object} - the LiveValidation object itself so that calls can be chained
     */
    remove: function(validationFunction, validationParamsObj){
        var found = false;
        for( var i = 0, len = this.validations.length; i < len; i++ ){
            if( this.validations[i].type == validationFunction ){
                if (this.validations[i].params == validationParamsObj) {
                  found = true;
                  break;
                }
            }
        }
        if(found) this.validations.splice(i,1);
        return this;
    },
    
  
    /**
     * makes the validation wait the alotted time from the last keystroke 
     */
    deferValidation: function(e){
      if(this.wait >= 300) this.removeMessageAndFieldClass();
      var self = this;
      if(this.timeout) clearTimeout(self.timeout);
      this.timeout = setTimeout( function(){ self.validate() }, self.wait); 
    },
        
    /**
     * sets the focused flag to false when field loses focus 
     */
    doOnBlur: function(e){
      this.focused = false;
      this.validate(e);
    },
        
    /**
     * sets the focused flag to true when field gains focus 
     */
    doOnFocus: function(e){
      this.focused = true;
      this.removeMessageAndFieldClass();
    },
    
    /**
     *  gets the type of element, to check whether it is compatible
     *
     *  @var validationFunction {Function} - validation function to be used (ie Validate.Presence )
     *  @var validationParamsObj {Object} - parameters for doing the validation, if wanted or necessary
     */
    getElementType: function(){
        var nodeName = this.element.nodeName.toUpperCase();
        if (nodeName == 'TEXTAREA')
            return LiveValidation.TEXTAREA;
        if (nodeName == 'INPUT' && this.element.type.toUpperCase() == 'TEXT')
            return LiveValidation.TEXT;
        if (nodeName == 'INPUT' && this.element.type.toUpperCase() == 'PASSWORD')
            return LiveValidation.PASSWORD;
        if (nodeName == 'INPUT' && this.element.type.toUpperCase() == 'CHECKBOX')
            return LiveValidation.CHECKBOX;
        if (nodeName == 'INPUT' && this.element.type.toUpperCase() == 'FILE')
            return LiveValidation.FILE;
        if (nodeName == 'INPUT' && this.element.type.toUpperCase() == 'RADIO')
            return LiveValidation.RADIO;
        if (nodeName == 'INPUT' && this.element.type.toUpperCase() == 'EMAIL')
            return LiveValidation.TEXT;
        if (nodeName == 'INPUT' && this.element.type.toUpperCase() == 'TEL')
            return LiveValidation.TEXT;
        if (nodeName == 'INPUT' && this.element.type.toUpperCase() == 'NUMBER')
            return LiveValidation.TEXT;
        if (nodeName == 'INPUT' && this.element.type.toUpperCase() == 'URL')
            return LiveValidation.TEXT;
        if (nodeName == 'SELECT')
            return LiveValidation.SELECT;
        if (nodeName == 'INPUT')
            throw new Error('LiveValidation::getElementType - Cannot use LiveValidation on an ' + this.element.type + ' input!');
        throw new Error('LiveValidation::getElementType - Element must be an input, select, or textarea!');
    },
    
    /**
     * Loops through all the validations added to the LiveValidation object and checks them one by one
     *
     * @var validationFunction {Function} - validation function to be used (ie Validate.Presence )
     * @var validationParamsObj {Object} - parameters for doing the validation, if wanted or necessary
     * @return {Boolean} - whether the all the validations passed or if one failed
     */
    doValidations: function(isSubmit, submitTrigger){
        var result;
        
        this.validationFailed = false;
        this.validationAsync = false;
        for(var i = 0, len = this.validations.length; i < len; ++i){
            var validation = this.validations[i];
            switch(validation.type){
                case Validate.Presence:
                case Validate.Confirmation:
                case Validate.Acceptance:
                  this.displayMessageWhenEmpty = true;
                  result = this.validateElement(validation.type, validation.params, isSubmit, submitTrigger); 
                  break;
                default:
                  result = this.validateElement(validation.type, validation.params, isSubmit, submitTrigger);
                  break;
            }
            this.validationFailed = !result;
            if(this.validationFailed) return false; 
          }
          this.message = this.validMessage;
          return true;
    },
    
    /**
     * Check if there is an async validation.
     */
    isAsync: function (){
        for(var i = 0, len = this.validations.length; i < len; ++i){
            var validation = this.validations[i];
            if (validation.type == Validate.Postback)
                return true;
        }
        return false;
    },
    
    /**
     * Performs validation on the element and handles any error (validation or otherwise) it throws up
     *
     * @var validationFunction {Function} - validation function to be used (ie Validate.Presence )
     * @var validationParamsObj {Object} - parameters for doing the validation, if wanted or necessary
     * @var isSubmit {Boolean} - is this a form submit or an individual field check
     * @var submitTrigger {Object} - the element that triggered the submit
     * @return {Boolean} or {"async"} - whether the validation has passed, failed or waits for an async server side check
     */
    validateElement: function(validationFunction, validationParamsObj, isSubmit, submitTrigger){
        var value = this.getValue();
        if(validationFunction == Validate.Acceptance){
            if(this.elementType != LiveValidation.CHECKBOX) 
                throw new Error('LiveValidation::validateElement - Element to validate acceptance must be a checkbox!');
            value = this.element.checked;
        }
        var isValid = true;
        try {
            isValid = validationFunction(value, validationParamsObj, isSubmit, submitTrigger);
            if (isValid == 'async') {
                this.validationAsync = true;
            }
        } 
        catch(error) {
            if(error instanceof Validate.Error){
                if( value !== '' || (value === '' && this.displayMessageWhenEmpty) ){
                    this.validationFailed = true;
                    this.message = error.message;
                    isValid = false;
                }
            } else {
                throw error;
            }
        }
        return isValid;
    },
    
    
    getValue: function() {
		switch (this.elementType) {
		case LiveValidation.SELECT:
			return this.element.options[this.element.selectedIndex].value;
		case LiveValidation.RADIO:
			var val = $('input[name='+this.element.name+']:checked').val();
			return val;
		default:
			return this.element.value;
		}
    },

    /**
     * Do all the validations and fires off the onValid or onInvalid callbacks
     *
     * @var isSubmit {Boolean} - is this a form submit or an individual field check
     * @var submitTrigger {Object} - the element that triggered the submit
     * @return {Boolean} - whether all the validations passed or if one failed
     */
    validate: function(isSubmit, submitTrigger){
        if(!this.element.disabled) {
            var isValid = this.doValidations(isSubmit, submitTrigger);
            if (this.validationAsync) {
                this.onAsync();
                return false;
            } else if (isValid) {
                this.onValid();
                return true;
            } else {
                this.onInvalid();
                return false;
            }
        } else {
            return true;
        }
    },
  
    /**
     * Called when there is an async validation result.
     * The caller has already checked if the current input value hasn't changed.
     */
    asyncValidationResult: function(isValid){
        if (this.validationAsync){
            // Find which validation was waiting for async, assume only one async postback per field.
            for(var i = 0, len = this.validations.length; i < len; ++i){
                var validation = this.validations[i];
                if(validation.type == Validate.Postback){
                    // Clear the async wait flag
                    this.validationAsync = false;
                    this.validationFailed = !isValid;
                    if (isValid){
                        this.onValid();
                    } else {
                        this.onInvalid();
                    }
                    this.formObj.asyncResult(this, isValid)
                }
            }
        }
    },
    
    /**
     *  enables the field
     *
     *  @return {LiveValidation} - the LiveValidation object for chaining
     */
    enable: function(){
        this.element.disabled = false;
        return this;
    },

    /**
     *  disables the field and removes any message and styles associated with the field
     *
     *  @return {LiveValidation} - the LiveValidation object for chaining
     */
    disable: function(){
        this.element.disabled = true;
        this.removeMessageAndFieldClass();
        return this;
    },
    
    /** Message insertion methods ****************************
     * 
     * These are only used in the onValid and onInvalid callback functions and so if you overide the default callbacks,
     * you must either impliment your own functions to do whatever you want, or call some of these from them if you 
     * want to keep some of the functionality
     */
 
     /**
      *  makes a span containing a spinner image
      *
      * @return {HTMLSpanObject} - a span element with the message in it
      */
     createSpinnerSpan: function(){
         var span = document.createElement('span');
         span.innerHTML = '<img src="/lib/images/spinner.gif" height="16" width="16" alt="Validating..." />';
         return span;
     },
   
    /**
     *  makes a span containg the passed or failed message
     *
     * @return {HTMLSpanObject} - a span element with the message in it
     */
    createMessageSpan: function(){
        var span = document.createElement('span');
        var textNode = document.createTextNode(this.message);
        span.appendChild(textNode);
        return span;
    },
    
    /**
     * Show an error message
     */
    showErrorMessage: function(message){
        this.message = message;
        this.onInvalid();
    },
    
    /** 
     * Insert a spinner in the message element.
     */
    insertSpinner: function (elementToInsert){
        this.removeMessage();
        if( (this.displayMessageWhenEmpty && (this.elementType == LiveValidation.CHECKBOX || this.element.value == ''))
          || this.element.value != '' ){

          elementToInsert.className += ' ' + this.messageClass + ' ' + this.asyncFieldClass;
          if(this.insertAfterWhatNode.nextSibling){
              this.insertAfterWhatNode.parentNode.insertBefore(elementToInsert, this.insertAfterWhatNode.nextSibling);
          }else{
              this.insertAfterWhatNode.parentNode.appendChild(elementToInsert);
          }
        }
        
    },
    
    /**
     *  inserts the element containing the message in place of the element that already exists (if it does)
     *
     * @var elementToIsert {HTMLElementObject} - an element node to insert
     */
    insertMessage: function(elementToInsert){
        this.removeMessage();
		if (this.elementType != LiveValidation.RADIO) {
	        if( (this.displayMessageWhenEmpty && (this.elementType == LiveValidation.CHECKBOX || this.element.value == ''))
	            || this.element.value != '' ){
            
	            var className = this.validationFailed ? this.invalidClass : this.validClass;
	            elementToInsert.className += ' ' + this.messageClass + ' ' + className;
	            if(this.insertAfterWhatNode.nextSibling){
	              this.insertAfterWhatNode.parentNode.insertBefore(elementToInsert, this.insertAfterWhatNode.nextSibling);
	            }else{
	                  this.insertAfterWhatNode.parentNode.appendChild(elementToInsert);
	            }
			 }
	      }
    },
    
    
    /**
     *  changes the class of the field based on whether it is valid or not
     */
    addFieldClass: function(){
        this.removeFieldClass();
        if(!this.validationFailed){
            if(this.displayMessageWhenEmpty || this.element.value != ''){
				switch (this.elementType) {
				case LiveValidation.RADIO:
	            	$('input[name='+this.element.name+']').closest('label').addClass(this.validFieldClass);
					break;
				default:
                	$(this.element).addClass(this.validFieldClass);
					break;
				}
            }
        }else{
			switch (this.elementType) {
			case LiveValidation.RADIO:
            	$('input[name='+this.element.name+']').closest('label').addClass(this.invalidFieldClass);
				break;
			default:
            	$(this.element).addClass(this.invalidFieldClass);
				break;
			}
        }
    },
    
    /**
     *  removes the message element if it exists, so that the new message will replace it
     */
    removeMessage: function(){
      var nextEl;
      var el = this.insertAfterWhatNode;
      while(el.nextSibling){
          if(el.nextSibling.nodeType === 1){
            nextEl = el.nextSibling;
            break;
        }
        el = el.nextSibling;
      }
        if(nextEl && nextEl.className.indexOf(this.messageClass) != -1) this.insertAfterWhatNode.parentNode.removeChild(nextEl);
    },
    
    /**
     *  removes the class that has been applied to the field to indicate if valid or not
     */
    removeFieldClass: function(){
		switch (this.elementType) {
		case LiveValidation.RADIO:
        	$('input[name='+this.element.name+']').closest('label').removeClass(this.invalidFieldClass).removeClass(this.validFieldClass);
			break;
		default:
    		$(this.element).removeClass(this.invalidFieldClass).removeClass(this.validFieldClass);
			break;
		}
    },
        
    /**
     *  removes the message and the field class
     */
    removeMessageAndFieldClass: function(){
      this.removeMessage();
      this.removeFieldClass();
    }

} // end of LiveValidation class




/*************************************** LiveValidationForm class ****************************************/
/**
 * This class is used internally by LiveValidation class to associate a LiveValidation field with a form it is icontained in one
 * 
 * It will therefore not really ever be needed to be used directly by the developer, unless they want to associate a LiveValidation 
 * field with a form that it is not a child of
 */

/**
   *  handles validation of LiveValidation fields belonging to this form on its submittal
   *  
   *  @var element {HTMLFormElement} - a dom element reference to the form to turn into a LiveValidationForm
   */
var LiveValidationForm = function(element){
  this.initialize(element);
}

/**
 * namespace to hold instances
 */
LiveValidationForm.instances = {};

/**
   *  gets the instance of the LiveValidationForm if it has already been made or creates it if it doesnt exist
   *  
   *  @var element {HTMLFormElement} - a dom element reference to a form
   */
LiveValidationForm.getInstance = function(element){
  var rand = Math.random() * Math.random();
  if(!$(element).attr("id"))
    $(element).attr("id", 'formId_' + rand.toString().replace(/\./, '') + new Date().valueOf());
  if(!LiveValidationForm.instances[$(element).attr("id")])
    LiveValidationForm.instances[$(element).attr("id")] = new LiveValidationForm(element);
  return LiveValidationForm.instances[$(element).attr("id")];
}

LiveValidationForm.prototype = {
  
  /**
   *  constructor for LiveValidationForm - handles validation of LiveValidation fields belonging to this form on its submittal
   *  
   *  @var element {HTMLFormElement} - a dom element reference to the form to turn into a LiveValidationForm
   */
  initialize: function(element){
    this.name = $(element).attr("id");
    this.element = element;
    this.fields = [];
    this.skipValidations = 0;
    this.submitWaitForAsync = new Array();
    this.onInvalid = function(){};

    // preserve the old onsubmit event
    this.oldOnSubmit = this.element.onsubmit || function(){};
    var self = this;

    $(element).submit(function(event) {
        event.zIsValidated = true;
        if (self.skipValidations == 0) {
            var result = true;
            var async = new Array();

            for(var i = 0, len = self.fields.length; i < len; ++i ) {
                if (!self.fields[i].element.disabled) {
                    if (self.fields[i].isAsync()) {
                        async.push(self.fields[i]);
                    } else {
                        var valid = self.fields[i].validate(true, this.clk);
                        if(result) 
                            result = valid;
                    }
                }
            }

            if (async.length > 0){
                if (result)
                    self.submitWaitForAsync = async;
                for(var i=0; i<async.length; i++){
                    async[i].validate(true, this.clk);
                }
                result = false;
            }
			else if (!result) {
				self.onInvalid.call(this);
			}
            
            if (!result) {
                // Either validation failed or we are waiting for more async results.
                event.stopImmediatePropagation();
                return false;
            } else {
                return z_form_submit_validated_do(event);
            }
        } else {
            self.skipValidations--;
            if (self.skipValidations == 0)
                return z_form_submit_validated_do(event);
            else
                return false;
        }
    })
  },
  
  /**
   *  adds a LiveValidation field to the forms fields array
   *  
   *  @var element {LiveValidation} - a LiveValidation object
   */
  addField: function(newField){
    this.fields.push(newField);
  },
  
  /**
   *  removes a LiveValidation field from the forms fields array
   *  
   *  @var victim {LiveValidation} - a LiveValidation object
   */
  removeField: function(victim){
    var victimless = [];
    for( var i = 0, len = this.fields.length; i < len; i++){
        if(this.fields[i] !== victim)
            victimless.push(this.fields[i]);
    }
    this.fields = victimless;
  },
  
  /**
   *  destroy this instance and its events
   *
   * @var force {Boolean} - whether to force the detruction even if there are fields still associated
   */
  destroy: function(force){
    // only destroy if has no fields and not being forced
    if (this.fields.length != 0 && !force) return false;
    // remove events - set back to previous events
    this.element.onsubmit = this.oldOnSubmit;
    // remove from the instances namespace
    LiveValidationForm.instances[this.name] = null;
    return true;
  },
  
  asyncResult: function(Validation, isValid){
      if (isValid){
          var index = $.inArray(Validation, this.submitWaitForAsync);
          if (index >= 0){
              this.submitWaitForAsync.splice(index, 1);
              if (this.submitWaitForAsync.length == 0){
                  // All validations were successful, resubmit (and skip validations for once)
                  this.skipValidations = 1;
                  var formObj = this.element;
                  setTimeout(function(){ $(formObj).submit(); }, 0);
              }
          }
      } else {
		  if (this.submitWaitForAsync.length > 0) {
			 this.onInvalid.call(this);
		  }
          this.submitWaitForAsync = new Array();
      }
  }
}// end of LiveValidationForm prototype




/*************************************** Validate class ****************************************/
/**
 * This class contains all the methods needed for doing the actual validation itself
 *
 * All methods are static so that they can be used outside the context of a form field
 * as they could be useful for validating stuff anywhere you want really
 *
 * All of them will return true if the validation is successful, but will raise a ValidationError if
 * they fail, so that this can be caught and the message explaining the error can be accessed ( as just 
 * returning false would leave you a bit in the dark as to why it failed )
 *
 * Can use validation methods alone and wrap in a try..catch statement yourself if you want to access the failure
 * message and handle the error, or use the Validate::now method if you just want true or false
 */

var Validate = {

    /**
     *  validates that the field has been filled in
     *
     *  @var value {mixed} - value to be checked
     *  @var paramsObj {Object} - parameters for this particular validation, see below for details
     *
     *  paramsObj properties:
     *              failureMessage {String} - the message to show when the field fails validation 
     *                            (DEFAULT: "Can't be empty!")
     */
    Presence: function(value, paramsObj){
        var paramsObj = paramsObj || {};
        var message = paramsObj.failureMessage || "*";
        if(value === '' || value === null || value === undefined){ 
            Validate.fail(message);
        }
        return true;
    },
    
    /**
     *  validates that the value is numeric, does not fall within a given range of numbers
     *  
     *  @var value {mixed} - value to be checked
     *  @var paramsObj {Object} - parameters for this particular validation, see below for details
     *
     *  paramsObj properties:
     *              notANumberMessage {String} - the message to show when the validation fails when value is not a number
     *                                (DEFAULT: "Must be a number!")
     *              notAnIntegerMessage {String} - the message to show when the validation fails when value is not an integer
     *                                (DEFAULT: "Must be a number!")
     *              wrongNumberMessage {String} - the message to show when the validation fails when is param is used
     *                                (DEFAULT: "Must be {is}!")
     *              tooLowMessage {String}    - the message to show when the validation fails when minimum param is used
     *                                (DEFAULT: "Must not be less than {minimum}!")
     *              tooHighMessage {String}   - the message to show when the validation fails when maximum param is used
     *                                (DEFAULT: "Must not be more than {maximum}!")
     *              is {Int}          - the length must be this long 
     *              minimum {Int}         - the minimum length allowed
     *              maximum {Int}         - the maximum length allowed
     *                         onlyInteger {Boolean} - if true will only allow integers to be valid
     *                                                             (DEFAULT: false)
     *
     *  NB. can be checked if it is within a range by specifying both a minimum and a maximum
     *  NB. will evaluate numbers represented in scientific form (ie 2e10) correctly as numbers       
     */
    Numericality: function(value, paramsObj){
        var suppliedValue = value;
        var value = Number(value);
        var paramsObj = paramsObj || {};
        var minimum = ((paramsObj.minimum) || (paramsObj.minimum == 0)) ? paramsObj.minimum : null;;
        var maximum = ((paramsObj.maximum) || (paramsObj.maximum == 0)) ? paramsObj.maximum : null;
        var is = ((paramsObj.is) || (paramsObj.is == 0)) ? paramsObj.is : null;
        var notANumberMessage = paramsObj.notANumberMessage || "Must be a number.";
        var notAnIntegerMessage = paramsObj.notAnIntegerMessage || "Must be an integer.";
        var wrongNumberMessage = paramsObj.wrongNumberMessage || "Must be " + is + ".";
        var tooLowMessage = paramsObj.tooLowMessage || "Must not be less than " + minimum + ".";
        var tooHighMessage = paramsObj.tooHighMessage || "Must not be more than " + maximum + ".";
        
        if (!isFinite(value)) 
            Validate.fail(notANumberMessage);
        if (paramsObj.onlyInteger && (/\.0+$|\.$/.test(String(suppliedValue))  || value != parseInt(value)) )
            Validate.fail(notAnIntegerMessage);
        switch(true){
            case (is !== null):
                if( value != Number(is) ) Validate.fail(wrongNumberMessage);
                break;
            case (minimum !== null && maximum !== null):
                Validate.Numericality(value, {tooLowMessage: tooLowMessage, minimum: minimum});
                Validate.Numericality(value, {tooHighMessage: tooHighMessage, maximum: maximum});
                break;
            case (minimum !== null):
                if( value < Number(minimum) ) Validate.fail(tooLowMessage);
                break;
            case (maximum !== null):
                if( value > Number(maximum) ) Validate.fail(tooHighMessage);
                break;
        }
        return true;
    },
    
    /**
     *  validates against a RegExp pattern
     *  
     *  @var value {mixed} - value to be checked
     *  @var paramsObj {Object} - parameters for this particular validation, see below for details
     *
     *  paramsObj properties:
     *              failureMessage {String} - the message to show when the field fails validation
     *                            (DEFAULT: "Not valid!")
     *              pattern {RegExp}    - the regular expression pattern
     *                            (DEFAULT: /./)
     *             negate {Boolean} - if set to true, will validate true if the pattern is not matched
   *                           (DEFAULT: false)
     *
     *  NB. will return true for an empty string, to allow for non-required, empty fields to validate.
     *    If you do not want this to be the case then you must either add a LiveValidation.PRESENCE validation
     *    or build it into the regular expression pattern
     */
    Format: function(value, paramsObj){
      var value = String(value);
      var paramsObj = paramsObj || {};
      var message = paramsObj.failureMessage || "Not valid.";
      var pattern = paramsObj.pattern || /./;
      var negate = paramsObj.negate || false;
      if(!negate && !pattern.test(value)) Validate.fail(message); // normal
      if(negate && pattern.test(value)) Validate.fail(message); // negated
      return true;
    },
    
    /**
     *  validates that the field contains a valid email address
     *  
     *  @var value {mixed} - value to be checked
     *  @var paramsObj {Object} - parameters for this particular validation, see below for details
     *
     *  paramsObj properties:
     *              failureMessage {String} - the message to show when the field fails validation
     *                            (DEFAULT: "Must be a number!" or "Must be an integer!")
     */
    Email: function(value, paramsObj){
      var paramsObj = paramsObj || {};
      var message = paramsObj.failureMessage || "Incorrect E-mail";
      value = $.trim(value);
      Validate.Format(value, { failureMessage: message, pattern: /^([^@\s]+)@((?:[-a-z0-9]+\.)+[a-z]{2,})$/i } );
      return true;
    },
    
    /**
     *  validates the length of the value
     *  
     *  @var value {mixed} - value to be checked
     *  @var paramsObj {Object} - parameters for this particular validation, see below for details
     *
     *  paramsObj properties:
     *              wrongLengthMessage {String} - the message to show when the fails when is param is used
     *                                (DEFAULT: "Must be {is} characters long!")
     *              tooShortMessage {String}  - the message to show when the fails when minimum param is used
     *                                (DEFAULT: "Must not be less than {minimum} characters long!")
     *              tooLongMessage {String}   - the message to show when the fails when maximum param is used
     *                                (DEFAULT: "Must not be more than {maximum} characters long!")
     *              is {Int}          - the length must be this long 
     *              minimum {Int}         - the minimum length allowed
     *              maximum {Int}         - the maximum length allowed
     *
     *  NB. can be checked if it is within a range by specifying both a minimum and a maximum       
     */
    Length: function(value, paramsObj){
        var value = String(value);
        var paramsObj = paramsObj || {};
        var minimum = ((paramsObj.minimum) || (paramsObj.minimum == 0)) ? paramsObj.minimum : null;
        var maximum = ((paramsObj.maximum) || (paramsObj.maximum == 0)) ? paramsObj.maximum : null;
        var is = ((paramsObj.is) || (paramsObj.is == 0)) ? paramsObj.is : null;
        var wrongLengthMessage = paramsObj.wrongLengthMessage || "Must be " + is + " characters long.";
        var tooShortMessage = paramsObj.tooShortMessage || "Must not be less than " + minimum + " characters long.";
        var tooLongMessage = paramsObj.tooLongMessage || "Must not be more than " + maximum + " characters long.";
        switch(true){
            case (is !== null):
                if( value.length != Number(is) ) Validate.fail(wrongLengthMessage);
                break;
            case (minimum !== null && maximum !== null):
                Validate.Length(value, {tooShortMessage: tooShortMessage, minimum: minimum});
                Validate.Length(value, {tooLongMessage: tooLongMessage, maximum: maximum});
                break;
            case (minimum !== null):
                if( value.length < Number(minimum) ) Validate.fail(tooShortMessage);
                break;
            case (maximum !== null):
                if( value.length > Number(maximum) ) Validate.fail(tooLongMessage);
                break;
            default:
                throw new Error("Validate::Length - Length(s) to validate against must be provided");
        }
        return true;
    },
    
    /**
     *  validates that the value falls within a given set of values
     *  
     *  @var value {mixed} - value to be checked
     *  @var paramsObj {Object} - parameters for this particular validation, see below for details
     *
     *  paramsObj properties:
     *              failureMessage {String} - the message to show when the field fails validation
     *                            (DEFAULT: "Must be included in the list!")
     *              within {Array}      - an array of values that the value should fall in 
     *                            (DEFAULT: []) 
     *              allowNull {Bool}    - if true, and a null value is passed in, validates as true
     *                            (DEFAULT: false)
     *             partialMatch {Bool}  - if true, will not only validate against the whole value to check but also if it is a substring of the value 
     *                            (DEFAULT: false)
     *             caseSensitive {Bool} - if false will compare strings case insensitively
     *                          (DEFAULT: true)
     *             negate {Bool}    - if true, will validate that the value is not within the given set of values
     *                            (DEFAULT: false)      
     */
    Inclusion: function(value, paramsObj){
      var paramsObj = paramsObj || {};
      var message = paramsObj.failureMessage || "Must be included in the list!";
      var caseSensitive = (paramsObj.caseSensitive === false) ? false : true;
      if(paramsObj.allowNull && value == null) return true;
      if(!paramsObj.allowNull && value == null) Validate.fail(message);
      var within = paramsObj.within || [];
      //if case insensitive, make all strings in the array lowercase, and the value too
      if(!caseSensitive){ 
        var lowerWithin = [];
        for(var j = 0, length = within.length; j < length; ++j){
          var item = within[j];
          if(typeof item == 'string') item = item.toLowerCase();
          lowerWithin.push(item);
        }
        within = lowerWithin;
        if(typeof value == 'string') value = value.toLowerCase();
      }
      var found = false;
      for(var i = 0, length = within.length; i < length; ++i){
        if(within[i] == value) found = true;
        if(paramsObj.partialMatch){ 
          if(value.indexOf(within[i]) != -1) found = true;
        }
      }
      if( (!paramsObj.negate && !found) || (paramsObj.negate && found) ) Validate.fail(message);
      return true;
    },
    
    /**
     *  validates that the value does not fall within a given set of values
     *  
     *  @var value {mixed} - value to be checked
     *  @var paramsObj {Object} - parameters for this particular validation, see below for details
     *
     *  paramsObj properties:
     *              failureMessage {String} - the message to show when the field fails validation
     *                            (DEFAULT: "Must not be included in the list!")
     *              within {Array}      - an array of values that the value should not fall in 
     *                            (DEFAULT: [])
     *              allowNull {Bool}    - if true, and a null value is passed in, validates as true
     *                            (DEFAULT: false)
     *             partialMatch {Bool}  - if true, will not only validate against the whole value to check but also if it is a substring of the value 
     *                            (DEFAULT: false)
     *             caseSensitive {Bool} - if false will compare strings case insensitively
     *                          (DEFAULT: true)     
     */
    Exclusion: function(value, paramsObj){
      var paramsObj = paramsObj || {};
      paramsObj.failureMessage = paramsObj.failureMessage || "Must not be included in the list";
      paramsObj.negate = true;
      Validate.Inclusion(value, paramsObj);
      return true;
    },
    
    /**
     *  validates that the value matches that in another field
     *  
     *  @var value {mixed} - value to be checked
     *  @var paramsObj {Object} - parameters for this particular validation, see below for details
     *
     *  paramsObj properties:
     *              failureMessage {String} - the message to show when the field fails validation
     *                            (DEFAULT: "Does not match!")
     *              match {String}      - id of the field that this one should match            
     */
    Confirmation: function(value, paramsObj){
        if(!paramsObj.match) 
            throw new Error("Validate::Confirmation - Error validating confirmation: Id of element to match must be provided");
        var paramsObj = paramsObj || {};
        var message = paramsObj.failureMessage || "Does not match.";
        var match = paramsObj.match.nodeName ? paramsObj.match : document.getElementById(paramsObj.match);
        if(!match) 
            throw new Error("Validate::Confirmation - There is no reference with name of, or element with id of '" + paramsObj.match + "'");
        if(value != match.value){ 
          Validate.fail(message);
        }
        return true;
    },
    
    /**
     *  validates that the value is true (for use primarily in detemining if a checkbox has been checked)
     *  
     *  @var value {mixed} - value to be checked if true or not (usually a boolean from the checked value of a checkbox)
     *  @var paramsObj {Object} - parameters for this particular validation, see below for details
     *
     *  paramsObj properties:
     *              failureMessage {String} - the message to show when the field fails validation 
     *                            (DEFAULT: "Must be accepted!")
     */
    Acceptance: function(value, paramsObj){
        var paramsObj = paramsObj || {};
        var message = paramsObj.failureMessage || "Must be accepted.";
        if(!value){ 
        Validate.fail(message);
        }
        return true;
    },
    
   /**
     *  validates against a custom function that returns true or false (or throws a Validate.Error) when passed the value
     *  
     *  @var value {mixed} - value to be checked
     *  @var paramsObj {Object} - parameters for this particular validation, see below for details
     *
     *  paramsObj properties:
     *              failureMessage {String} - the message to show when the field fails validation
     *                            (DEFAULT: "Not valid!")
     *              against {Function}      - a function that will take the value and object of arguments and return true or false 
     *                            (DEFAULT: function(){ return true; })
     *              args {Object}     - an object of named arguments that will be passed to the custom function so are accessible through this object within it 
     *                            (DEFAULT: {})
     */
    Custom: function(value, paramsObj, isSubmit, submitTrigger){
        var paramsObj = paramsObj || {};
        var against = paramsObj.against || function(){ return true; };
        var args = paramsObj.args || {};
        var message = paramsObj.failureMessage || "Not valid.";
        if(!against(value, args, isSubmit, submitTrigger)) Validate.fail(message);
        return true;
    },


    /**
     * Performs a postback, delays the check till the postback is returned. till then a spinner is shown
     * next to the input element. 
     */
    Postback: function(value, paramsObj, isSubmit, submitTrigger) {
        var paramsObj = paramsObj || {};
        var against = paramsObj.against || function(){ return true; };
        var args = paramsObj.args || {};
        var message = paramsObj.failureMessage || "Not valid.";

        if (!against(value, args, isSubmit, submitTrigger)) {
            Validate.fail(message);
        } else if (paramsObj.z_postback) {
            // Perform the async postback
            extraParams = new Array();
            if (isSubmit) {
                extraParams.push({name: 'z_submitter', value: (submitTrigger && submitTrigger.name) ? submitTrigger.name : ''});
            }
            z_queue_postback(paramsObj.z_id, paramsObj.z_postback, extraParams); 
            return 'async';
        } else {
            return true;
        }
     },

  
    /**
     *  validates whatever it is you pass in, and handles the validation error for you so it gives a nice true or false reply
     *
     *  @var validationFunction {Function} - validation function to be used (ie Validation.validatePresence )
     *  @var value {mixed} - value to be checked if true or not (usually a boolean from the checked value of a checkbox)
     *  @var validationParamsObj {Object} - parameters for doing the validation, if wanted or necessary
     */
    now: function(validationFunction, value, validationParamsObj){
        if(!validationFunction) throw new Error("Validate::now - Validation function must be provided!");
      var isValid = true;
        try{    
        validationFunction(value, validationParamsObj || {});
      } catch(error) {
        if(error instanceof Validate.Error){
          isValid =  false;
        }else{
          throw error;
        }
      }finally{ 
            return isValid 
        }
    },
    
    /**
     * shortcut for failing throwing a validation error
     *
     *  @var errorMessage {String} - message to display
     */
    fail: function(errorMessage){
            throw new Validate.Error(errorMessage);
    },
    
    Error: function(errorMessage){
      this.message = errorMessage;
      this.name = 'ValidationError';
    }

}
;
/* inputoverlay js
----------------------------------------------------------

@package:	Zotonic 2010	
@Author: 	Marc Worrell <marc@worrell.nl>

Copyright 2010 Marc Worrell

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
 
http://www.apache.org/licenses/LICENSE-2.0
 
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

---------------------------------------------------------- */

/*
This widget overlays a label field with an input field.  When the input
is empty the label is visible.  When there is content then the label is hidden.

HTML:

<p class="do_inputoverlay">
	<span>Username</span>
	<input type="text" id="username" name="username" value="" />
</p>

CSS:

p.do_inputoverlay {
	margin: 0px;
	padding: 0px;
	position: relative;
	height: 40px;
	font-size: 18px;
}

p.do_inputoverlay input {
	position: absolute;
	left: 0px;
	background: none;
	font-size: 18px;
}

p.do_inputoverlay span {
	position: absolute;
	left: 8px;
	top: 5px;
	color: #aaa;
}

p.do_inputoverlay span.focus {
	color: #d8d8d8;
}

p.do_inputoverlay span.hidden {
	display: none;
}

*/

$.widget("ui.inputoverlay", 
{
	_init: function() 
	{
		var self = this;
		var obj  = this.element;
		var input = $('input', obj);
		var span = $('span', obj);
		
	    var func = function(focus) {
		    if ($(input).val() == "") {
		        if (focus) {
    		        $(span).removeClass('hidden').addClass('focus');
		        } else {
    		        $(span).removeClass('hidden').removeClass('focus');
		        }
		    } else {
		        $(span).removeClass('focus').addClass('hidden');
		    }
		};
		
		input.change(function() {
		    func(true);
		}).focus(function() {
		    func(true);
		}).blur(function() {
		    func(false);
		}).keydown(function() {
		    setTimeout(function(){func(true);},10);
		}).keyup(function() {
		    func(true);
		});
		
		if (input.attr('autocomplete') == 'on') {
    	    setInterval(function() {
    		    if ($(input).val() == "") {
    		        $(span).removeClass('hidden');
    		    } else {
    		        $(span).addClass('hidden');
    		    }
    		}, 100);
		}
    }    
});
;
/**
 * Copyright (c) 2009 Sergiy Kovalchuk (serg472@gmail.com)
 * 
 * Dual licensed under the MIT (http://www.opensource.org/licenses/mit-license.php)
 * and GPL (http://www.opensource.org/licenses/gpl-license.php) licenses.
 *  
 * Following code is based on Element.mask() implementation from ExtJS framework (http://extjs.com/)
 *
 */
;(function($){
	
	/**
	 * Displays loading mask over selected element(s). Accepts both single and multiple selectors.
	 *
	 * @param label Text message that will be displayed on top of the mask besides a spinner (optional). 
	 * 				If not provided only mask will be displayed without a label or a spinner.  	
	 * @param delay Delay in milliseconds before element is masked (optional). If unmask() is called 
	 *              before the delay times out, no mask is displayed. This can be used to prevent unnecessary 
	 *              mask display for quick processes.   	
	 */
	$.fn.mask = function(label, delay){
		$(this).each(function() {
			if(delay !== undefined && delay > 0) {
		        var element = $(this);
		        element.data("_mask_timeout", setTimeout(function() { $.maskElement(element, label)}, delay));
			} else {
				$.maskElement($(this), label);
			}
		});
	};
	
	/**
	 * Removes mask from the element(s). Accepts both single and multiple selectors.
	 */
	$.fn.unmask = function(){
		$(this).each(function() {
			$.unmaskElement($(this));
		});
	};
	
	/**
	 * Checks if a single element is masked. Returns false if mask is delayed or not displayed. 
	 */
	$.fn.isMasked = function(){
		return this.hasClass("masked");
	};

	/**
	 * Show or update the upload progressbar
	 */
	$.fn.maskProgress = function(value){
		$(this).each(function() {
			$.maskProgress($(this), value);
		});
	};

	$.maskElement = function(element, label){
	
		//if this element has delayed mask scheduled then remove it and display the new one
		if (element.data("_mask_timeout") !== undefined) {
			clearTimeout(element.data("_mask_timeout"));
			element.removeData("_mask_timeout");
		}

		if(element.isMasked()) {
			$.unmaskElement(element);
		}
		
		if(element.css("position") == "static") {
			element.addClass("masked-relative");
		}
		
		element.addClass("masked");
		
		var maskDiv = $('<div class="loadmask"></div>');
		
		//auto height fix for IE
		if(navigator.userAgent.toLowerCase().indexOf("msie") > -1){
			maskDiv.height(element.height() + parseInt(element.css("padding-top")) + parseInt(element.css("padding-bottom")));
			maskDiv.width(element.width() + parseInt(element.css("padding-left")) + parseInt(element.css("padding-right")));
		}
		
		//fix for z-index bug with selects in IE6
		if(navigator.userAgent.toLowerCase().indexOf("msie 6") > -1){
			element.find("select").addClass("masked-hidden");
		}
		
		element.append(maskDiv);
		
		if ($(element).progressbar != undefined) {
			var maskProgressDiv = $('<div class="loadmask-progress" style="display:none;"></div>');
			element.append(maskProgressDiv);
			element.find(".loadmask-progress").progressbar({value: 0});
		}
		if(label !== undefined) {
			var maskMsgDiv = $('<div class="loadmask-msg" style="display:none;"></div>');
			maskMsgDiv.append('<div>' + label + '</div>');
			element.append(maskMsgDiv);
			
			//calculate center position
			maskMsgDiv.css("top", Math.round(element.height() / 2 - (maskMsgDiv.height() - parseInt(maskMsgDiv.css("padding-top")) - parseInt(maskMsgDiv.css("padding-bottom"))) / 2)+"px");
			maskMsgDiv.css("left", Math.round(element.width() / 2 - (maskMsgDiv.width() - parseInt(maskMsgDiv.css("padding-left")) - parseInt(maskMsgDiv.css("padding-right"))) / 2)+"px");
			
			maskMsgDiv.show();
		}
	};
	
	$.maskProgress = function(element, value){
		if ($(element).progressbar != undefined) {
			element.find(".loadmask-progress").show().progressbar('option', 'value', value);
			element.find(".loadmask-msg").hide();
		}
	};
	
	$.unmaskElement = function(element){
		//if this element has delayed mask scheduled then remove it
		if (element.data("_mask_timeout") !== undefined) {
			clearTimeout(element.data("_mask_timeout"));
			element.removeData("_mask_timeout");
		}
		
		element.find(".loadmask-msg,.loadmask-progress,.loadmask").remove();
		element.removeClass("masked");
		element.removeClass("masked-relative");
		element.find("select").removeClass("masked-hidden");
	};
 
})(jQuery);