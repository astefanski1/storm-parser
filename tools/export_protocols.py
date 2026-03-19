import sys
import json
import importlib

sys.path.append('.')

def main():
    module_name = sys.argv[1].replace('.py', '')
    proto = importlib.import_module(module_name)
    
    data = {
        "version": getattr(proto, "version", 0),
        "typeinfos": getattr(proto, "typeinfos", []),
        "game_event_types": getattr(proto, "game_event_types", {}),
        "game_eventid_typeid": getattr(proto, "game_eventid_typeid", 0),
        "message_event_types": getattr(proto, "message_event_types", {}),
        "message_eventid_typeid": getattr(proto, "message_eventid_typeid", 0),
        "tracker_event_types": getattr(proto, "tracker_event_types", {}),
        "tracker_eventid_typeid": getattr(proto, "tracker_eventid_typeid", 0),
        "svaruint32_typeid": getattr(proto, "svaruint32_typeid", 0),
        "replay_userid_typeid": getattr(proto, "replay_userid_typeid", 0),
        "replay_header_typeid": getattr(proto, "replay_header_typeid", 0),
        "game_details_typeid": getattr(proto, "game_details_typeid", 0),
        "replay_initdata_typeid": getattr(proto, "replay_initdata_typeid", 0)
    }
    
    print(json.dumps(data))

if __name__ == '__main__':
    main()
