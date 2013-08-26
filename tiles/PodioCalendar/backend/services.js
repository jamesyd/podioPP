/*
* Copyright 2013 Jive Software
*
*    Licensed under the Apache License, Version 2.0 (the "License");
*    you may not use this file except in compliance with the License.
*    You may obtain a copy of the License at
*
*       http://www.apache.org/licenses/LICENSE-2.0
*
*    Unless required by applicable law or agreed to in writing, software
*    distributed under the License is distributed on an "AS IS" BASIS,
*    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*    See the License for the specific language governing permissions and
*    limitations under the License.
*/


var jive = require("jive-sdk");


function doDataPush(instance) {

    var ticketID = instance['config']['ticketID'];

    var tokenStore = jive.service.persistence();
    tokenStore.find('tokens', {'ticket': ticketID }).then(function (found) {
        if (found) {
            var accessToken = found[0]['accessToken']['access_token'];

            jive.util.buildRequest(
                    "https://api.podio.com/calendar/?date_from=2013-08-01&date_to=2014-08-26&priority=1&oauth_token=" + accessToken,
                    'GET'
                ).then(
                // success
                function (response) {
                    var calData = response['entity'];

                    if (calData) {
                        var dataToPush={
                            data : {"title" : "Upcoming Events",
                                "events" :[{}] ,
                                "action" : {"text" : "Check out the full calendar" , "url" : "https://podio.com/calendar"}
                            }
                        };
                        var title;
                        var description;
                        var location;

                        for (var i=0; i<calData.length; i++)
                        {
                            title = calData[i].title;
                            description =  calData[i].description;
                            location = calData[i].location;

                            if (title == null) {
                                title = "* title: undefined";
                                calData[i].title = title;
                            }
                            if (description == null) {
                                description = "* description: undefined *";
                                calData[i].description = description;
                            }
                            if (location == null) {
                                location = "* location: undefined *"  ;
                                calData[i].location = location;
                            }
                            if (title.length >= 50)
                            {
                                // truncate to fit in tile ..
                                title = title.substring(0,46);
                                title += " ..";
                            }
                            if (description.length >= 50)
                            {
                                // truncate to fit in tile ..
                                description = description.substring(0,46);
                                description += " ..";
                            }

                            dataToPush.data.events[i] = {};
                            dataToPush.data.events[i].title = title;
                            dataToPush.data.events[i].location = location;
                            dataToPush.data.events[i].start = calData[i].start_date + "T12:00:00-08:00";
                            dataToPush.data.events[i].description = description;
                            dataToPush.data.events[i].action = {text : "Take a closer look ...",
                                            context : {name : calData[i].title, description : calData[i].description,
                                            start_date : calData[i].start_date, location: calData[i].location,
                                            url : calData[i].link}} ;
                        }

                        jive.tiles.pushData(instance, dataToPush).then(function (e) {
                            console.log('* podioCalendar success*');
                        }, function (e) {
                            console.log('* podioCalendar err*');
                        });

                        //console.log(contacts);
                    }
                },

                // fail
                function (response) {
                    console.log("Failed to query!");
                }
            );
        }
    });
}
function processTileInstance(instance) {
    jive.logger.debug('running pusher for ', instance.name, 'instance', instance.id);
    doDataPush(instance);
}

exports.task = new jive.tasks.build(
    // runnable
    function() {
        jive.tiles.findByDefinitionName( 'PodioCalendar' ).then( function(instances) {
            if ( instances ) {
                instances.forEach( function( instance ) {
                    processTileInstance(instance);
                });
            }
        });
    },

    // interval (optional)
    5000
);
